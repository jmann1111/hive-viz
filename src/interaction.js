import * as THREE from 'three';

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
const plane = new THREE.Plane();
const intersection = new THREE.Vector3();

let draggedNode = null;
let isDragging = false;
let clickStart = null;

export function initInteraction(camera, renderer, graph, nodeMeshes, controls, onNodeClick) {
  const canvas = renderer.domElement;

  // Tooltip element
  const tooltip = document.createElement('div');
  tooltip.style.cssText = 'position:fixed;pointer-events:none;background:rgba(5,5,16,0.9);border:1px solid rgba(155,77,255,0.3);padding:6px 12px;border-radius:6px;font-size:12px;color:#e2e8f0;font-family:system-ui;z-index:200;opacity:0;transition:opacity 0.15s;white-space:nowrap;';
  document.body.appendChild(tooltip);

  function getMouseNDC(event) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
  }

  function raycastNodes(event) {
    getMouseNDC(event);
    raycaster.setFromCamera(mouse, camera);
    for (const group of nodeMeshes) {
      const hits = raycaster.intersectObject(group.mesh);
      if (hits.length > 0) {
        const instanceId = hits[0].instanceId;
        for (const [nodeId, { instanceIdx }] of group.indices) {
          if (instanceIdx === instanceId) return nodeId;
        }
      }
    }
    return null;
  }

  canvas.addEventListener('mousedown', (e) => {
    clickStart = { x: e.clientX, y: e.clientY, time: Date.now() };
    const nodeId = raycastNodes(e);
    if (nodeId) {
      draggedNode = nodeId;
      controls.enabled = false;
      canvas.style.cursor = 'grabbing';
      graph.reheat(0.3);
      const node = graph.getNode(nodeId);
      if (node) {
        const nodePos = new THREE.Vector3(node.x, node.y, node.z);
        plane.setFromNormalAndCoplanarPoint(
          camera.getWorldDirection(new THREE.Vector3()).negate(),
          nodePos
        );
      }
    }
  });

  canvas.addEventListener('mousemove', (e) => {
    if (draggedNode) {
      isDragging = true;
      getMouseNDC(e);
      raycaster.setFromCamera(mouse, camera);
      if (raycaster.ray.intersectPlane(plane, intersection)) {
        graph.pinNode(draggedNode, intersection.x, intersection.y);
      }
      tooltip.style.opacity = '0';
    } else {
      const hovered = raycastNodes(e);
      if (hovered) {
        canvas.style.cursor = 'grab';
        const node = graph.getNode(hovered);
        const neighbors = graph.getNeighbors(hovered);
        if (node) {
          tooltip.innerHTML = `<strong>${node.title}</strong><br><span style="color:#888">${node.folder} &bull; ${neighbors.length} links &bull; ${node.wordCount}w</span>`;
          tooltip.style.left = (e.clientX + 16) + 'px';
          tooltip.style.top = (e.clientY - 10) + 'px';
          tooltip.style.opacity = '1';
        }
      } else {
        canvas.style.cursor = 'default';
        tooltip.style.opacity = '0';
      }
    }
  });

  canvas.addEventListener('mouseup', (e) => {
    if (draggedNode) {
      const wasDrag = isDragging && clickStart &&
        (Math.abs(e.clientX - clickStart.x) > 5 || Math.abs(e.clientY - clickStart.y) > 5);
      if (!wasDrag && onNodeClick) {
        onNodeClick(draggedNode);
      }
      graph.unpinNode(draggedNode);
      draggedNode = null;
      isDragging = false;
      controls.enabled = true;
      canvas.style.cursor = 'default';
    }
    clickStart = null;
  });

  canvas.addEventListener('mouseleave', () => {
    tooltip.style.opacity = '0';
  });
}
