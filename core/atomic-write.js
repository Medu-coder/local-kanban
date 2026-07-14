import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import {
  MAX_MARKDOWN_BYTES,
  FilesystemSafetyError,
  assertPathWithinRoot,
} from "./paths.js";

function toBuffer(content) {
  if (typeof content === "string") {
    return Buffer.from(content, "utf8");
  }
  if (Buffer.isBuffer(content) || content instanceof Uint8Array) {
    return Buffer.from(content);
  }
  throw new TypeError("El contenido debe ser string, Buffer o Uint8Array.");
}

async function lstatIfExists(targetPath) {
  try {
    return await fs.lstat(targetPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function assertSafeTarget(targetPath) {
  const stat = await lstatIfExists(targetPath);
  if (!stat) {
    return null;
  }
  if (stat.isSymbolicLink()) {
    throw new FilesystemSafetyError("No se puede reemplazar un symlink.", "SYMLINK_PATH");
  }
  if (!stat.isFile()) {
    throw new FilesystemSafetyError("El destino debe ser un fichero regular.", "NOT_REGULAR_FILE");
  }
  return stat;
}

async function unlinkIfExists(targetPath) {
  try {
    await fs.unlink(targetPath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

export async function atomicWriteFile(filePath, content, options = {}) {
  if (!path.isAbsolute(filePath)) {
    throw new FilesystemSafetyError("El destino debe ser una ruta absoluta.", "PATH_NOT_ABSOLUTE");
  }

  const maxBytes = options.maxBytes ?? MAX_MARKDOWN_BYTES;
  const buffer = toBuffer(content);
  if (buffer.byteLength > maxBytes) {
    throw new FilesystemSafetyError(`El contenido supera el limite de ${maxBytes} bytes.`, "FILE_TOO_LARGE");
  }

  const targetPath = options.rootPath
    ? await assertPathWithinRoot(options.rootPath, filePath)
    : path.resolve(filePath);
  const parentDir = path.dirname(targetPath);
  const parentStat = await fs.lstat(parentDir);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new FilesystemSafetyError("El directorio de destino no es seguro.", "UNSAFE_PARENT_DIRECTORY");
  }

  const existingStat = await assertSafeTarget(targetPath);
  const mode = options.mode ?? (existingStat ? existingStat.mode & 0o777 : 0o644);
  const tempPath = path.join(
    parentDir,
    `.${path.basename(targetPath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let handle = null;

  try {
    handle = await fs.open(tempPath, "wx", mode);
    await handle.writeFile(buffer);
    await handle.sync();
    await handle.close();
    handle = null;

    if (options.rootPath) {
      await assertPathWithinRoot(options.rootPath, targetPath);
    }
    await assertSafeTarget(targetPath);
    await fs.rename(tempPath, targetPath);

    const directoryHandle = await fs.open(parentDir, "r");
    try {
      await directoryHandle.sync();
    } finally {
      await directoryHandle.close();
    }

    return targetPath;
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => {});
    }
    await unlinkIfExists(tempPath).catch(() => {});
    throw error;
  }
}
