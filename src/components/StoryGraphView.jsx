import { useEffect, useMemo, useRef, useState } from "react";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation } from "d3-force";
import { zoomIdentity } from "d3-zoom";
import { buildStoryGraph } from "../lib/graph";

const edgeMeta = {
  epic: { label: "Épica", distance: 110, strength: 0.22 },
  blocked_by: { label: "Blocked by", distance: 150, strength: 0.18 },
  blocks: { label: "Blocks", distance: 150, strength: 0.18 },
  related_to: { label: "Related to", distance: 185, strength: 0.1 },
};

function truncateLabel(label, isLongLabelEnabled, maxLength = 26) {
  if (isLongLabelEnabled || label.length <= maxLength) {
    return label;
  }

  return `${label.slice(0, maxLength - 1)}…`;
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}

function statusTone(status) {
  switch (status) {
    case "done":
      return "done";
    case "testing":
      return "testing";
    case "developing":
      return "developing";
    default:
      return "backlog";
  }
}

export function StoryGraphView({
  project,
  onSelectStory,
  onSelectEpic,
  onBackgroundClick,
}) {
  const stageRef = useRef(null);
  const svgRef = useRef(null);
  const viewportRef = useRef(null);
  const transformRef = useRef(zoomIdentity);
  const simulationRef = useRef(null);
  const animationFrameRef = useRef(null);
  const transformAnimationRef = useRef(null);
  const fitGraphKeyRef = useRef("");
  const panStateRef = useRef(null);
  const nodeDragStateRef = useRef(null);
  const suppressCanvasClickRef = useRef(false);
  const [size, setSize] = useState({ width: 1280, height: 760 });
  const [showRelated, setShowRelated] = useState(true);
  const [showLongLabels, setShowLongLabels] = useState(false);
  const [visibilityFilters, setVisibilityFilters] = useState({
    epic: true,
    backlog: true,
    developing: true,
    testing: true,
    done: true,
    blocked: true,
    related: true,
  });
  const [hoveredNodeId, setHoveredNodeId] = useState(null);
  const [selectedNodeId, setSelectedNodeId] = useState(null);
  const [selectedConstellationId, setSelectedConstellationId] = useState(null);
  const [viewportTransform, setViewportTransform] = useState(() => zoomIdentity.toString());
  const [renderedGraph, setRenderedGraph] = useState({ nodes: [], edges: [], stats: null });

  function stopTransformAnimation() {
    if (transformAnimationRef.current !== null) {
      window.cancelAnimationFrame(transformAnimationRef.current);
      transformAnimationRef.current = null;
    }
  }

  const graph = useMemo(
    () =>
      buildStoryGraph(project, {
        showRelated,
        width: size.width,
        height: size.height,
      }),
    [project, showRelated, size.height, size.width]
  );

  const adjacency = useMemo(() => {
    const neighbors = new Map();

    for (const node of graph.nodes) {
      neighbors.set(node.id, new Set());
    }

    for (const edge of graph.edges) {
      neighbors.get(edge.source)?.add(edge.target);
      neighbors.get(edge.target)?.add(edge.source);
    }

    return neighbors;
  }, [graph.edges, graph.nodes]);

  const graphKey = useMemo(
    () =>
      `${showRelated}:${size.width}x${size.height}:${graph.nodes.map((node) => node.id).join("|")}:${graph.edges
        .map((edge) => edge.id)
        .join("|")}`,
    [graph.edges, graph.nodes, showRelated, size.height, size.width]
  );

  const visibleGraph = useMemo(() => {
    const nodes = renderedGraph.nodes.filter((node) => {
      if (node.kind === "epic") {
        return visibilityFilters.epic;
      }

      return visibilityFilters[statusTone(node.status)];
    });

    const visibleNodeIds = new Set(nodes.map((node) => node.id));
    const edges = renderedGraph.edges.filter((edge) => {
      if (!visibleNodeIds.has(edge.source.id ?? edge.source) || !visibleNodeIds.has(edge.target.id ?? edge.target)) {
        return false;
      }

      if (edge.kind === "related_to") {
        return visibilityFilters.related;
      }

      if (edge.kind === "blocked_by" || edge.kind === "blocks") {
        return visibilityFilters.blocked;
      }

      return true;
    });

    return {
      nodes,
      edges,
      stats: {
        stories: nodes.filter((node) => node.kind === "story").length,
        epics: nodes.filter((node) => node.kind === "epic").length,
        relations: edges.filter((edge) => edge.kind !== "epic").length,
      },
    };
  }, [renderedGraph.edges, renderedGraph.nodes, visibilityFilters]);

  function selectNode(nodeId) {
    setSelectedNodeId(nodeId);

    const node = renderedGraph.nodes.find((item) => item.id === nodeId);
    if (!node) {
      return;
    }

    if (node.kind === "epic") {
      onSelectEpic(node.entityId);
      return;
    }

    const story = project.stories.find((item) => item.id === node.entityId);
    if (story) {
      onSelectStory(story);
    }
  }

  function getConstellationId(node) {
    if (!node) {
      return null;
    }

    return node.kind === "epic" ? node.entityId : node.epicId ?? "__no_epic__";
  }

  function buildFitTransform(nodes) {
    return buildFocusTransform(nodes, { maxScale: 0.68, paddingRatioX: 0.16, paddingRatioY: 0.18 });
  }

  function buildFocusTransform(
    nodes,
    {
      maxScale = 0.94,
      paddingRatioX = 0.24,
      paddingRatioY = 0.28,
      minPaddingX = 120,
      minPaddingY = 120,
      extraRadiusX = 44,
      extraRadiusY = 72,
    } = {}
  ) {
    if (!nodes.length) {
      return zoomIdentity;
    }

    const paddingX = Math.max(minPaddingX, Math.round(size.width * paddingRatioX));
    const paddingY = Math.max(minPaddingY, Math.round(size.height * paddingRatioY));
    const minX = Math.min(...nodes.map((node) => node.x - node.radius - extraRadiusX));
    const maxX = Math.max(...nodes.map((node) => node.x + node.radius + extraRadiusX));
    const minY = Math.min(...nodes.map((node) => node.y - node.radius - extraRadiusY * 0.6));
    const maxY = Math.max(...nodes.map((node) => node.y + node.radius + extraRadiusY));
    const boundsWidth = Math.max(maxX - minX, 1);
    const boundsHeight = Math.max(maxY - minY, 1);
    const availableWidth = Math.max(size.width - paddingX * 2, 1);
    const availableHeight = Math.max(size.height - paddingY * 2, 1);
    const scale = Math.max(0.08, Math.min(maxScale, Math.min(availableWidth / boundsWidth, availableHeight / boundsHeight)));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    return zoomIdentity
      .translate(size.width / 2 - centerX * scale, size.height / 2 - centerY * scale)
      .scale(scale);
  }

  function applyTransform(transform, duration = 0) {
    stopTransformAnimation();

    if (duration <= 0) {
      transformRef.current = transform;
      setViewportTransform(transform.toString());
      return;
    }

    const start = transformRef.current ?? zoomIdentity;
    const startTime = performance.now();
    const total = Math.max(duration, 1);

    function step(now) {
      const progress = Math.min(1, (now - startTime) / total);
      const eased = 1 - (1 - progress) * (1 - progress);
      const next = zoomIdentity
        .translate(
          start.x + (transform.x - start.x) * eased,
          start.y + (transform.y - start.y) * eased
        )
        .scale(start.k + (transform.k - start.k) * eased);

      transformRef.current = next;
      setViewportTransform(next.toString());
      if (progress < 1) {
        transformAnimationRef.current = window.requestAnimationFrame(step);
      } else {
        transformAnimationRef.current = null;
      }
    }

    transformAnimationRef.current = window.requestAnimationFrame(step);
  }

  function fitGraphToViewport(nodes, duration = 0) {
    applyTransform(buildFitTransform(nodes), duration);
  }

  function focusGraphNodes(nodes, duration = 0) {
    if (!nodes.length) {
      return;
    }

    const target = buildFocusTransform(nodes, {
      maxScale: 0.96,
      paddingRatioX: 0.22,
      paddingRatioY: 0.24,
      minPaddingX: 96,
      minPaddingY: 96,
      extraRadiusX: 34,
      extraRadiusY: 52,
    });
    const current = transformRef.current ?? zoomIdentity;
    const minimumFocusScale = nodes.length <= 3 ? 1.12 : 1.02;
    const targetScale = Math.max(current.k, target.k, minimumFocusScale);
    const minX = Math.min(...nodes.map((node) => node.x - node.radius - 34));
    const maxX = Math.max(...nodes.map((node) => node.x + node.radius + 34));
    const minY = Math.min(...nodes.map((node) => node.y - node.radius - 28));
    const maxY = Math.max(...nodes.map((node) => node.y + node.radius + 48));
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    const transform = zoomIdentity
      .translate(size.width / 2 - centerX * targetScale, size.height / 2 - centerY * targetScale)
      .scale(targetScale);

    applyTransform(transform, duration);
  }

  useEffect(() => {
    const element = stageRef.current;
    if (!element) {
      return undefined;
    }

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) {
        return;
      }

      const nextWidth = Math.max(720, Math.round(entry.contentRect.width));
      const nextHeight = Math.max(620, Math.round(entry.contentRect.height));
      setSize((current) =>
        current.width === nextWidth && current.height === nextHeight
          ? current
          : { width: nextWidth, height: nextHeight }
      );
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = svgRef.current;
    if (!element) {
      return undefined;
    }

    function handleNativeWheel(event) {
      event.preventDefault();
      event.stopPropagation();
      const current = transformRef.current ?? zoomIdentity;
      const point = getLocalPoint(event.clientX, event.clientY);
      const graphX = (point.x - current.x) / current.k;
      const graphY = (point.y - current.y) / current.k;
      const nextScale = Math.max(0.08, Math.min(2.5, current.k * Math.pow(2, -event.deltaY / 600)));
      const next = zoomIdentity
        .translate(point.x - graphX * nextScale, point.y - graphY * nextScale)
        .scale(nextScale);

      applyTransform(next);
    }

    element.addEventListener("wheel", handleNativeWheel, { passive: false });
    return () => element.removeEventListener("wheel", handleNativeWheel);
  }, [renderedGraph.nodes.length]);

  useEffect(() => {
    if (!visibleGraph.nodes.length) {
      setSelectedNodeId(null);
      setSelectedConstellationId(null);
      setHoveredNodeId(null);
      onBackgroundClick?.();
      return;
    }

    if (selectedNodeId && !visibleGraph.nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(null);
      setSelectedConstellationId(null);
      setHoveredNodeId(null);
      onBackgroundClick?.();
      fitGraphToViewport(visibleGraph.nodes, 150);
      return;
    }

    if (
      selectedConstellationId &&
      !visibleGraph.nodes.some((node) => getConstellationId(node) === selectedConstellationId)
    ) {
      setSelectedConstellationId(null);
      setHoveredNodeId(null);
    }
  }, [onBackgroundClick, selectedConstellationId, selectedNodeId, visibleGraph.nodes]);

  useEffect(() => {
    if (!graph.nodes.length) {
      setRenderedGraph({ nodes: [], edges: [], stats: graph.stats });
      return undefined;
    }

    const nodes = graph.nodes.map((node) => ({ ...node }));
    const nodeLookup = new Map(nodes.map((node) => [node.id, node]));
    const links = graph.edges
      .map((edge) => {
        const sourceNode = nodeLookup.get(edge.source);
        const targetNode = nodeLookup.get(edge.target);
        if (!sourceNode || !targetNode) {
          return null;
        }

        return {
          ...edge,
          source: sourceNode,
          target: targetNode,
        };
      })
      .filter(Boolean);

    const simulation = forceSimulation(nodes)
      .force(
        "link",
        forceLink(links)
          .id((node) => node.id)
          .distance((link) => edgeMeta[link.kind]?.distance ?? 140)
          .strength((link) => edgeMeta[link.kind]?.strength ?? 0.16)
      )
      .force(
        "charge",
        forceManyBody().strength((node) => (node.kind === "epic" ? -840 : -300))
      )
      .force("center", forceCenter(size.width / 2, size.height / 2))
      .force(
        "collision",
        forceCollide().radius((node) => node.radius + (node.kind === "epic" ? 26 : 14))
      );

    const flushFrame = () => {
      animationFrameRef.current = null;
      setRenderedGraph({
        nodes: [...nodes],
        edges: links.map((edge) => ({ ...edge })),
        stats: graph.stats,
      });
    };

    simulation.on("tick", () => {
      if (animationFrameRef.current !== null) {
        return;
      }

      animationFrameRef.current = window.requestAnimationFrame(flushFrame);
    });

    simulationRef.current = simulation;
    simulation.stop();
    for (let tick = 0; tick < 320; tick += 1) {
      simulation.tick();
    }
    flushFrame();
    if (fitGraphKeyRef.current !== graphKey) {
      fitGraphKeyRef.current = graphKey;
      window.requestAnimationFrame(() => {
        fitGraphToViewport(nodes, 0);
      });
    }

    return () => {
      simulation.stop();
      simulationRef.current = null;
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [graph.edges, graph.nodes, graph.stats, size.height, size.width]);

  function getLocalPoint(clientX, clientY) {
    const bounds = svgRef.current?.getBoundingClientRect();
    if (!bounds) {
      return { x: 0, y: 0 };
    }

    return {
      x: clientX - bounds.left,
      y: clientY - bounds.top,
    };
  }

  function getGraphPoint(clientX, clientY) {
    const local = getLocalPoint(clientX, clientY);
    const transform = transformRef.current ?? zoomIdentity;

    return {
      x: (local.x - transform.x) / transform.k,
      y: (local.y - transform.y) / transform.k,
    };
  }

  function refreshGraphAfterNodeMove() {
    setRenderedGraph((current) => ({
      nodes: [...current.nodes],
      edges: [...current.edges],
      stats: current.stats,
    }));
  }

  function handleCanvasPointerDown(event) {
    if (event.button !== 0) {
      return;
    }

    if (event.target.closest(".graph-node")) {
      return;
    }

    event.preventDefault();
    stopTransformAnimation();
    svgRef.current?.setPointerCapture?.(event.pointerId);
    panStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: transformRef.current.x,
      originY: transformRef.current.y,
      originK: transformRef.current.k,
      moved: false,
    };
  }

  function handleCanvasPointerMove(event) {
    const nodeDragState = nodeDragStateRef.current;
    if (nodeDragState) {
      if (event.pointerId !== nodeDragState.pointerId) {
        return;
      }

      event.preventDefault();
      const nextPoint = getGraphPoint(event.clientX, event.clientY);
      const deltaX = nextPoint.x - nodeDragState.startGraphX;
      const deltaY = nextPoint.y - nodeDragState.startGraphY;
      if (Math.abs(deltaX) > 0.5 || Math.abs(deltaY) > 0.5) {
        nodeDragState.moved = true;
        suppressCanvasClickRef.current = true;
      }

      nodeDragState.node.x = nodeDragState.originX + deltaX;
      nodeDragState.node.y = nodeDragState.originY + deltaY;
      refreshGraphAfterNodeMove();
      return;
    }

    const panState = panStateRef.current;
    if (!panState || event.pointerId !== panState.pointerId) {
      return;
    }

    event.preventDefault();
    const deltaX = event.clientX - panState.startX;
    const deltaY = event.clientY - panState.startY;
    if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
      panState.moved = true;
      suppressCanvasClickRef.current = true;
    }

    applyTransform(
      zoomIdentity
        .translate(panState.originX + deltaX, panState.originY + deltaY)
        .scale(panState.originK),
      0
    );
  }

  function handleCanvasPointerUp(event) {
    const nodeDragState = nodeDragStateRef.current;
    if (nodeDragState && event?.pointerId === nodeDragState.pointerId && !nodeDragState.moved) {
      suppressCanvasClickRef.current = true;
      activateNode(nodeDragState.node);
    }

    if (event?.pointerId !== undefined) {
      svgRef.current?.releasePointerCapture?.(event.pointerId);
    }

    panStateRef.current = null;
    nodeDragStateRef.current = null;
  }

  function handleNodePointerDown(event, node) {
    if (event.button !== 0) {
      return;
    }

    event.stopPropagation();
    stopTransformAnimation();
    svgRef.current?.setPointerCapture?.(event.pointerId);
    const point = getGraphPoint(event.clientX, event.clientY);
    nodeDragStateRef.current = {
      pointerId: event.pointerId,
      node,
      startGraphX: point.x,
      startGraphY: point.y,
      originX: node.x,
      originY: node.y,
      moved: false,
    };
  }

  function resetZoom() {
    fitGraphToViewport(visibleGraph.nodes, 180);
  }

  function toggleVisibilityFilter(filterKey) {
    setVisibilityFilters((current) => {
      const next = {
        ...current,
        [filterKey]: !current[filterKey],
      };

      return next;
    });
  }

  function activateNode(node) {
    if (!node) {
      return;
    }

    setSelectedConstellationId(getConstellationId(node));
    selectNode(node.id);
    const constellationNodes = getConstellationNodes(node);
    window.setTimeout(() => {
      focusGraphNodes(constellationNodes, 120);
    }, 0);
  }

  function clearSelection() {
    setSelectedNodeId(null);
    setSelectedConstellationId(null);
    setHoveredNodeId(null);
    fitGraphToViewport(visibleGraph.nodes, 150);
    onBackgroundClick?.();
  }

  function getConstellationNodes(node) {
    if (!node) {
      return [];
    }

    const epicKey = node.kind === "epic" ? node.entityId : node.epicId ?? "__no_epic__";
    return visibleGraph.nodes.filter(
      (item) =>
        (item.kind === "epic" && item.entityId === epicKey) ||
        (item.kind === "story" && (item.epicId ?? "__no_epic__") === epicKey)
    );
  }

  const hoveredNode = hoveredNodeId ? visibleGraph.nodes.find((node) => node.id === hoveredNodeId) ?? null : null;
  const activeConstellationId = getConstellationId(hoveredNode) ?? selectedConstellationId;

  return (
    <section className="graph-shell" data-testid="story-graph-view" onClick={(event) => event.stopPropagation()}>
      <div className="graph-toolbar">
        <div className="graph-toolbar__summary">
          <span className="count-pill">{visibleGraph.stats?.relations ?? 0}</span>
          <div>
            <strong>Relaciones activas</strong>
            <p className="muted">Mapa vivo de épicas, historias y dependencias del proyecto.</p>
          </div>
        </div>

        <div className="graph-toolbar__actions">
          <button
            className="ghost-button"
            type="button"
            onClick={() => setShowLongLabels((current) => !current)}
            data-testid="graph-toggle-labels-button"
          >
            {showLongLabels ? "Etiquetas compactas" : "Etiquetas largas"}
          </button>
          <button
            className={`ghost-button ${showRelated ? "is-active" : ""}`}
            type="button"
            onClick={() => setShowRelated((current) => !current)}
            data-testid="graph-toggle-related-button"
          >
            {showRelated ? "Ocultar related" : "Mostrar related"}
          </button>
          <button
            className="ghost-button"
            type="button"
            onClick={resetZoom}
            data-testid="graph-reset-zoom-button"
          >
            Reset zoom
          </button>
        </div>
      </div>

      <div className="graph-legend" aria-label="Leyenda del grafo">
        <button
          className={`graph-legend__item graph-legend__item--epic ${visibilityFilters.epic ? "is-active" : "is-inactive"}`}
          type="button"
          onClick={() => toggleVisibilityFilter("epic")}
          aria-pressed={visibilityFilters.epic}
        >
          Épica
        </button>
        <button
          className={`graph-legend__item graph-legend__item--backlog ${visibilityFilters.backlog ? "is-active" : "is-inactive"}`}
          type="button"
          onClick={() => toggleVisibilityFilter("backlog")}
          aria-pressed={visibilityFilters.backlog}
        >
          Backlog
        </button>
        <button
          className={`graph-legend__item graph-legend__item--developing ${visibilityFilters.developing ? "is-active" : "is-inactive"}`}
          type="button"
          onClick={() => toggleVisibilityFilter("developing")}
          aria-pressed={visibilityFilters.developing}
        >
          Developing
        </button>
        <button
          className={`graph-legend__item graph-legend__item--testing ${visibilityFilters.testing ? "is-active" : "is-inactive"}`}
          type="button"
          onClick={() => toggleVisibilityFilter("testing")}
          aria-pressed={visibilityFilters.testing}
        >
          Testing
        </button>
        <button
          className={`graph-legend__item graph-legend__item--done ${visibilityFilters.done ? "is-active" : "is-inactive"}`}
          type="button"
          onClick={() => toggleVisibilityFilter("done")}
          aria-pressed={visibilityFilters.done}
        >
          Done
        </button>
        <button
          className={`graph-legend__item graph-legend__item--blocked ${visibilityFilters.blocked ? "is-active" : "is-inactive"}`}
          type="button"
          onClick={() => toggleVisibilityFilter("blocked")}
          aria-pressed={visibilityFilters.blocked}
        >
          Blocked by / Blocks
        </button>
        <button
          className={`graph-legend__item graph-legend__item--related ${visibilityFilters.related ? "is-active" : "is-inactive"}`}
          type="button"
          onClick={() => toggleVisibilityFilter("related")}
          aria-pressed={visibilityFilters.related}
        >
          Related to
        </button>
      </div>

      <div ref={stageRef} className="graph-stage">
        {visibleGraph.nodes.length ? (
          <svg
            ref={svgRef}
            className="graph-canvas"
            viewBox={`0 0 ${size.width} ${size.height}`}
            onPointerDown={handleCanvasPointerDown}
            onPointerMove={handleCanvasPointerMove}
            onPointerUp={handleCanvasPointerUp}
            onPointerLeave={handleCanvasPointerUp}
            onClick={(event) => {
              if (suppressCanvasClickRef.current) {
                suppressCanvasClickRef.current = false;
                return;
              }

              if (event.target.closest(".graph-node")) {
                return;
              }

              clearSelection();
            }}
          >
            <defs>
              <filter id="graph-node-glow" x="-120%" y="-120%" width="340%" height="340%">
                <feGaussianBlur stdDeviation="9" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <marker
                id="graph-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(255, 184, 132, 0.88)" />
              </marker>
            </defs>

            <g ref={viewportRef} transform={viewportTransform}>
              <rect
                className="graph-canvas__backdrop"
                x={-size.width * 2}
                y={-size.height * 2}
                width={size.width * 4}
                height={size.height * 4}
                fill="transparent"
              />
              {visibleGraph.edges.map((edge) => {
                const source = edge.source;
                const target = edge.target;
                const sourceConstellation = getConstellationId(source);
                const targetConstellation = getConstellationId(target);
                const isConnected =
                  !activeConstellationId ||
                  sourceConstellation === activeConstellationId ||
                  targetConstellation === activeConstellationId;

                return (
                  <line
                    key={edge.id}
                    x1={source.x}
                    y1={source.y}
                    x2={target.x}
                    y2={target.y}
                    className={`graph-edge graph-edge--${edge.kind} ${isConnected ? "is-active" : "is-dimmed"}`}
                    markerEnd={edge.kind === "related_to" || edge.kind === "epic" ? undefined : "url(#graph-arrow)"}
                  />
                );
              })}

              {visibleGraph.nodes.map((node) => {
                const isSelected = node.id === selectedNodeId;
                const isHighlighted =
                  !activeConstellationId || getConstellationId(node) === activeConstellationId;
                const tone = node.kind === "epic" ? "epic" : statusTone(node.status);

                return (
                  <g
                    key={node.id}
                    className={`graph-node graph-node--${tone} ${isHighlighted ? "is-highlighted" : "is-dimmed"} ${
                      isSelected ? "is-selected" : ""
                    }`}
                    transform={`translate(${node.x}, ${node.y})`}
                    onMouseEnter={() => setHoveredNodeId(node.id)}
                    onMouseLeave={() => setHoveredNodeId((current) => (current === node.id ? null : current))}
                    onPointerDown={(event) => handleNodePointerDown(event, node)}
                    data-testid={`graph-node-${node.kind}-${node.entityId}`}
                  >
                    <circle className="graph-node__halo" r={node.radius + 10} />
                    <circle className="graph-node__core" r={node.radius} filter="url(#graph-node-glow)" />
                    <text className="graph-node__percent" dy="0.38em">
                      {formatPercent(node.progress)}
                    </text>
                    <text className="graph-node__label" y={node.radius + 20}>
                      {truncateLabel(node.label, showLongLabels)}
                    </text>
                    {node.kind === "epic" ? (
                      <text className="graph-node__meta" y={node.radius + 38}>
                        {node.storyCount} historias
                      </text>
                    ) : null}
                  </g>
                );
              })}
            </g>
          </svg>
        ) : (
          <div className="empty-column">
            {renderedGraph.nodes.length
              ? "No hay elementos visibles con los filtros del grafo actuales."
              : "No hay historias visibles para construir el grafo con los filtros actuales."}
          </div>
        )}
      </div>
    </section>
  );
}
