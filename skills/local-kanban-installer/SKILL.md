---
name: "local-kanban-installer"
description: "Instala Local Kanban desde un enlace Git en la ruta que el usuario elija y deja el proyecto listo para configurar y arrancar."
---

# Local Kanban Installer Skill

Usa esta skill cuando el usuario te pida instalar `Local Kanban` desde un enlace Git y dejarlo preparado en su máquina con la mínima fricción posible.

Esta skill debe ser suficiente por sí sola para ejecutar la instalación.

## Objetivo

Clonar el repositorio en la ruta que el usuario indique, instalar dependencias, generar la configuración local desde plantilla y dejar el proyecto listo para arrancar.

## Flujo estándar

1. Decide la ruta de instalación con el usuario.
2. Clona el repositorio en esa ruta.
3. Entra en el directorio clonado.
4. Ejecuta `npm install`.
5. Ejecuta `npm run setup`.
6. Verifica que exista `config/projects.json`.
7. Si el usuario quiere dejarlo funcionando ya, edita `config/projects.json` y ejecuta `npm run dev`.

## Comandos esperados

```bash
git clone <repo-url> <ruta-destino>
cd <ruta-destino>
npm install
npm run setup
```

Si ya has preguntado al usuario por los proyectos y sus rutas, puedes evitar el asistente interactivo y dejarlo configurado en una sola orden:

```bash
npm run setup -- --projects-json '[{"name":"Mi proyecto","rootPath":"/ruta/absoluta/al/proyecto"}]'
```

## Qué hace `npm run setup`

- valida que haya Node.js 18 o superior
- crea `config/projects.json` desde `config/projects.example.json` si no existe
- abre un asistente guiado cuando hay terminal interactiva
- preserva `config/projects.json` si ya estaba configurado
- permite regenerarlo con `npm run setup:reset`
- permite modo sin preguntas con `npm run setup -- --no-interactive`
- permite configurar proyectos directamente con `npm run setup -- --projects-json '<json>'`

## Reglas

1. No sobrescribas `config/projects.json` existente salvo que el usuario lo pida.
2. No publiques ni commitees rutas locales reales del usuario.
3. Si el usuario solo pide instalar, no arranques el servidor sin pedirlo.
4. Si el usuario también quiere dejarlo operativo, usa el asistente guiado de `npm run setup` o pásale los proyectos con `--projects-json` y luego lanza `npm run dev`.

## Verificación mínima

Tras `npm run setup`, verifica:

- existe `config/projects.json`
- el repositorio tiene `node_modules` instalados
- el siguiente paso para el usuario es solo configurar rutas y arrancar

## Qué no hacer

- No intentes empaquetar un ejecutable nativo salvo que el usuario lo pida explícitamente.
- No conviertas el flujo en algo más complejo que `clone -> npm install -> npm run setup`.
