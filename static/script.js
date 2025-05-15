let gmlDoc = null;
let jsonDoc = null;
let jsonBlob = null;
const focusMap = {};
let selectedID = null;
let selectedOBJ = null;

document.getElementById('viewProcess').addEventListener('click', e => {
        if (!jsonDoc) {
            alert("Please upload a CityGML or CityJSON file first.");
            return;
        }

        const formData = new FormData();
        jsonBlob = new Blob([JSON.stringify(jsonDoc)], { type: 'application/json' });

        formData.append('file', jsonBlob);
        fetch('/visualize', {
            method: 'POST',
            body: formData
        })
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        })
        .then(data => {
        // Dynamically construct the absolute URL
            const glbFileName = data.response;
            const baseUrl = `${window.location.protocol}//${window.location.host}`;
            const glbUrl = `${baseUrl}/download/${glbFileName}`;

            console.log("Constructed GLB URL:", glbUrl); // Debugging
            viewWhole(glbUrl);
    
        })
        .catch(error => {
            console.error('There was a problem with the fetch operation:', error);
            alert("Error: " + error.message);
        });
      });

document.getElementById('shaclFile').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
    const parsed = JSON.parse(reader.result);
    const results = parsed?.shaclReport?.result || [];
    const fileValidation = parsed?.fileValidation;
  
  renderValidationSummary(fileValidation);

    results.forEach(res => {
        const nodeFull = res.focusNode;
        const nodeFullStr = typeof nodeFull === 'string' ? nodeFull : nodeFull?.['@id'] || '';
        const nodeIdMatch = nodeFullStr.match(/ID_\d+_\d+/);

        // Try to find identifier manually (works for hasWindows-style violations)
        const identifier = res.focusNode?.["http://purl.org/dc/terms/identifier"];
        const nodeId = identifier || nodeIdMatch?.[0];

        if (!nodeId) return;
        if (!focusMap[nodeId]) focusMap[nodeId] = [];
        focusMap[nodeId].push(res);
    });


    const ul = document.getElementById('focusNodeList');
    ul.innerHTML = '';
    Object.entries(focusMap).forEach(([nodeId, results]) => {
        const li = document.createElement('li');
        li.textContent = nodeId;
        li.addEventListener('click', () => toggleSublist(li, nodeId, results));
        ul.appendChild(li);
    });
    };
    reader.readAsText(file);
});

function renderValidationSummary(fileValidation) {
  const div = document.getElementById('val3dity');
  div.innerHTML = ''; // Clear previous

  if (!fileValidation || !Array.isArray(fileValidation) || fileValidation.length === 0) {
    div.innerHTML = "<i>No file validation data available.</i>";
    return;
  }

  const val3dity = fileValidation[0]?.val3dityReport?.features;
  if (!val3dity || val3dity.length === 0) {
    div.innerHTML = "<i>No val3dity feature reports found.</i>";
    return;
  }

  const invalidFeatures = val3dity.filter(f => f.validity === false);
  if (invalidFeatures.length === 0) {
    div.innerHTML = "<p>All geometries are valid.</p>";
    return;
  }

  let html = "<h4>Invalid Features from val3dity</h4><ul>";
  invalidFeatures.forEach(feature => {
    html += `<li><b>${feature.id}</b> (${feature.type})<ul>`;

    // General errors (at feature level)
    if (feature.errors && feature.errors.length > 0) {
      html += `<li data-feature-id="${feature.id}"><i>Feature-level errors:</i><ul>`;

      feature.errors.forEach(err => {
        html += `<li data-feature-id="${feature.id}">[${err.code}] ${err.description} — ${err.info}</li>`;

      });
      html += "</ul></li>";
    }

    // Primitive-specific errors
    feature.primitives?.forEach(prim => {
      if (prim.validity === false) {
        html += `<li data-feature-id="${feature.id}"><b>Primitive ${prim.id}</b> (${prim.type})<ul>`;

        prim.errors?.forEach(err => {
          html += `<li data-feature-id="${feature.id}">[${err.code}] ${err.description} — ${err.info}</li>`;

        });
        html += "</ul></li>";
      }
    });

    html += "</ul></li>";
  });

  html += "</ul>";
  div.innerHTML = html;
}



function toggleSublist(parentLi, nodeId, results) {
    let sublist = parentLi.querySelector('ul');
    if (sublist) {
    sublist.remove();
    return;
    }
    sublist = document.createElement('ul');
    sublist.className = 'sublist';

    results.forEach(r => {
    const subli = document.createElement('li');
    subli.textContent = r.resultMessage;
    subli.addEventListener('click', (e) => {
        e.stopPropagation();
        showGmlAttributes(nodeId, r);
    });
    sublist.appendChild(subli);
    });

    parentLi.appendChild(sublist);
}

document.getElementById('dataFile').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
    if (file.name.endsWith('.gml')){
    const parser = new DOMParser();
    gmlDoc = parser.parseFromString(reader.result, "text/xml");
    alert("CityGML file is loaded.");
    }
    else if (file.name.endsWith('.json')) {
        try {
        const parsed = JSON.parse(reader.result);
        if (parsed.type === 'CityJSON') {
            jsonDoc = parsed;
            alert("CityJSON file loaded.");
        }
        } catch {
        alert("Invalid JSON format.");
        }
    }
    };
    reader.readAsText(file);
});

function deepFindValueGML(element, attrName) {
    const candidates = element.getElementsByTagName("*");
    for (let i = 0; i < candidates.length; i++) {
        const el = candidates[i];
        if (el.localName === "name" && el.textContent === attrName) {
        const parent = el.parentElement;
        const valueEl = Array.from(parent.children).find(c => c.localName === "value");
        const value = valueEl ? valueEl.textContent : null;

        let source = parent;
        let gmlId = null;
        while (source && source !== element && !gmlId) {
            gmlId = source.getAttribute("gml:id") || source.getAttributeNS("http://www.opengis.net/gml", "id");
            source = source.parentElement;
        }
        gmlId = gmlId || "(gml:id can not be found)";
        return { value, gmlId };
        }
    }
    return null;
    }

function deepFindValueCityJSON(objectId, attrName) {
  if (!jsonDoc || !jsonDoc.CityObjects) return null;

  const visited = new Set();
  let result = null;

  // Search for the attribute inside each surface
  function searchInSurfaces(geometries, parentId) {
    if (!Array.isArray(geometries)) return;

    for (const geom of geometries) {
      const surfaces = geom?.semantics?.surfaces;
      if (!Array.isArray(surfaces)) continue;

      for (const surface of surfaces) {
        // if objectId matches surface.id, and surface has desired attribute
        if (surface.id === objectId && surface.hasOwnProperty(attrName)) {
          result = {
            value: surface[attrName],
            gmlId: parentId // return the parent CityObject ID
          };
          return;
        }

        // fallback: parent match, then find attribute in any surface
        if (surface.hasOwnProperty(attrName)) {
          result = {
            value: surface[attrName],
            gmlId: surface.id || '(no id)'
          };
          return;
        }
      }
    }
  }

  // Recurse through CityObjects
  function recurse(id) {
    if (!id || visited.has(id)) return;
    visited.add(id);

    const obj = jsonDoc.CityObjects[id];
    if (!obj) return;

    searchInSurfaces(obj.geometry, id);

    if (!result && Array.isArray(obj.children)) {
      obj.children.forEach(recurse);
    }
  }

  // First pass: regular CityObject lookup
  recurse(objectId);

  // Second pass: in case objectId is a surface id
  if (!result) {
    for (const [cid, obj] of Object.entries(jsonDoc.CityObjects)) {
      searchInSurfaces(obj.geometry, cid);
      if (result) break;
    }
  }

  return result;
}


function showGmlAttributes(gmlId, violation) {
    const output = document.getElementById('gmlDetails');
    output.innerHTML = '';
    const rawPath = violation.resultPath?.[0] || null;
    const path = rawPath?.includes('#') ? rawPath.split('#').pop() : rawPath;

    let html = '';

    if (!gmlDoc && !jsonDoc) {
        alert("Please upload a CityGML or CityJSON file first.");
        return;
    }

    let result = null;

    if (gmlDoc) {
        const allElements = gmlDoc.getElementsByTagName("*");
        let matchedElement = null;
        for (const el of allElements) {
        const id = el.getAttributeNS("http://www.opengis.net/gml", "id") || el.getAttribute("gml:id") || el.getAttribute("id");
        if (id === gmlId) {
            matchedElement = el;
            break;
        }
        }

        if (matchedElement && path) {
        result = deepFindValueGML(matchedElement, path);
        }
    }

    if (jsonDoc) {
        result = deepFindValueCityJSON(gmlId, path);
        console.log(result);
    }

    if (path && result) {
        const value = result && 'value' in result ? result.value : "Can not be found";
        const sourceId = result?.gmlId || "(Can not be found)";
        html += `<table><tr><th>Attribute</th><th>Value</th><th>Source gml:id</th></tr>`;
        html += `<tr><td>${path}</td><td ${value !== "Can not be found" ? '' : 'class="missing"'}>${value}</td><td>${value !== "Can not be found" ? sourceId : '-'}</td></tr>`;
        html += `</table>`;
    } else {
        html += `<div>Attribute can not be found.</div>`;
    }

    output.innerHTML = html;
}

function viewWhole(glbdata) {
    const container = document.getElementById('modelViewer');

    // Initialize scene, camera, and renderer
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(
        75,
        container.offsetWidth / container.offsetHeight,
        0.1,
        1000
    );
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.offsetWidth, container.offsetHeight);
    renderer.setClearColor(0xffffff, 1);
    container.appendChild(renderer.domElement);

    // Add lighting to the scene
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(500, 500, 500).normalize();
    scene.add(directionalLight);

    // Function to find an object by name or UUID
    function findObjectByNameOrUUID(model, id) {
        let targetObject = null;
        model.traverse((child) => {
            if (child.name === id || child.uuid === id) {
                targetObject = child;
            }
        });
        return targetObject;
    }

function findRenderableFallbackID(missingId, primitiveId = null) {
    if (!jsonDoc || !jsonDoc.CityObjects) return null;
    const CityObjects = jsonDoc.CityObjects;
    const obj = CityObjects[missingId];

    // 1. Try child match based on primitive ID
    if (obj?.children && primitiveId != null) {
        for (const childId of obj.children) {
            const child = CityObjects[childId];
            if (!child?.geometry) continue;

            for (const geom of child.geometry) {
                const surfaces = geom?.semantics?.surfaces || [];
                for (let i = 0; i < surfaces.length; i++) {
                    const surface = surfaces[i];
                    if (surface?.id && i === primitiveId) {
                        if (findObjectByNameOrUUID(scene, childId)) {
                            console.log(`Fallback matched primitive index ${primitiveId} in child ${childId}`);
                            return childId;
                        }
                    }
                }
            }
        }
    }

    // 2. Try first geometry-bearing child
    if (obj?.children) {
        for (const childId of obj.children) {
            if (findObjectByNameOrUUID(scene, childId)) {
                return childId;
            }
        }
    }

    // 3. Fallback: is this a semantic surface id inside a parent?
    for (const [cid, co] of Object.entries(CityObjects)) {
        if (!co.geometry) continue;
        for (const geom of co.geometry) {
            const surfaces = geom?.semantics?.surfaces || [];
            for (const surface of surfaces) {
                if (surface.id === missingId) {
                    if (findObjectByNameOrUUID(scene, cid)) return cid;
                }
            }
        }
    }

    return null;
}



    // Load the GLB model
    const loader = new THREE.GLTFLoader();
    loader.load(
        glbdata,
        function (gltf) {
            const model = gltf.scene;
            scene.add(model);

            // Center and scale the model
            model.scale.set(0.1, 0.1, 0.1);
            const box = new THREE.Box3().setFromObject(model);
            const center = box.getCenter(new THREE.Vector3());
            model.position.sub(center);

            // Add edges to the mesh
            model.traverse(child => {
                if (child.isMesh && child.geometry) {
                    const edgesGeometry = new THREE.EdgesGeometry(child.geometry);
                    const edgesMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });
                    const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
                    child.add(edges);
                }
            });

            // Start the animation loop
            animate();
        },
        undefined,
        function (error) {
            console.error('An error occurred while loading the GLB file:', error);
        }
    );

    // Set up the camera position
    camera.position.z = 10;

    // Add OrbitControls for interactivity
    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.minDistance = 1;
    controls.maxDistance = 1000;

    // Track zoom-in state
    let isAutoZooming = false; // Flag to control automatic zoom behavior
    let previousOBJ = null; // Store the previously selected object
    let originalMaterials = {}; // Store original materials for restoration

    // Animation loop
    function animate() {
        requestAnimationFrame(animate);

        // Update controls (if damping is enabled)
        controls.update();

        // Rotate the model (optional)
        if (scene.children[0]) {
            scene.children[0].rotation.y += 0.01;
        }

        // Perform zoom-in animation if isAutoZooming is true
        if (selectedOBJ && isAutoZooming) {
            // Define the zoom behavior
            const zoomSpeed = 0.05; // Adjust this value for faster/slower zoom
            const minDistance = 5; // Minimum distance from the object
            const maxDistance = 100; // Maximum distance from the object
            const angleOffset = Math.PI / 6; // Angle offset (30 degrees in radians)

            // Calculate the bounding box of the selected object
            const boundingBox = new THREE.Box3().setFromObject(selectedOBJ);
            const center = boundingBox.getCenter(new THREE.Vector3());

            // Set the controls' target to the object's center
            controls.target.copy(center);

            // Adjust the camera's distance to the object
            const currentDistance = camera.position.distanceTo(center);
            let targetDistance = currentDistance - zoomSpeed;

            // Clamp the distance to ensure it stays within the min/max range
            targetDistance = Math.max(minDistance, Math.min(maxDistance, targetDistance));

            // Stop auto-zooming once the minimum distance is reached
            if (currentDistance <= minDistance) {
                isAutoZooming = false; // Disable automatic zoom
            }

            // Calculate the new camera position with an angle offset
            const direction = center.clone().sub(camera.position).normalize(); // Direction vector from camera to object
            const horizontalPosition = direction.clone().multiplyScalar(targetDistance); // Horizontal position
            const verticalOffset = new THREE.Vector3(0, Math.sin(angleOffset) * targetDistance, 0); // Vertical offset
            const newPosition = center.clone().add(horizontalPosition).add(verticalOffset); // Final position

            // Move the camera towards the new position
            camera.position.lerp(newPosition, 0.1); // Smoothing factor

            // Ensure the camera looks at the object
            camera.lookAt(controls.target);
        }

        // Render the scene
        renderer.render(scene, camera);
    }

    function startZoomAnimation(id, primitiveId = null) {
    if (previousOBJ && originalMaterials[previousOBJ.uuid]) {
        previousOBJ.material = originalMaterials[previousOBJ.uuid];
        delete originalMaterials[previousOBJ.uuid];
    }

    selectedID = id;
    selectedOBJ = findObjectByNameOrUUID(scene, selectedID);

    if (!selectedOBJ) {
        console.warn(`Object with ID "${selectedID}" not found. Trying fallback.`);
        const fallbackId = findRenderableFallbackID(selectedID, primitiveId);  // ✅ pass primitiveId here
        if (fallbackId) {
            console.log(`Trying fallback ID: ${fallbackId}`);
            selectedID = fallbackId;
            selectedOBJ = findObjectByNameOrUUID(scene, selectedID);
        }
    }

    if (selectedOBJ) {
                    // Store the original material of the new selected object
        if (!originalMaterials[selectedOBJ.uuid]) {
            originalMaterials[selectedOBJ.uuid] = selectedOBJ.material.clone(); // Clone the original material
        }

        // Apply a temporary material for the selected object
        selectedOBJ.material = new THREE.MeshStandardMaterial({
            color: 0xff0000, // Example: Red color
            transparent: true,
            opacity: 0.5 // Semi-transparent during zoom
        });

        // Reset the previous object reference
        previousOBJ = selectedOBJ;

        // Start the zoom-in animation
        isAutoZooming = true;
        console.log("Starting zoom-in animation for:", selectedID);
        
    } else {
        console.warn(`Object with ID "${selectedID}" not found in GLB (even after fallback).`);
    }
}


    // Example: Trigger zoom-in animation when a URI is clicked
    document.getElementById("val3dity").addEventListener("click", function (event) {
    let target = event.target;
    let featureItem = null;

    while (target && target !== this) {
        if (target.hasAttribute("data-feature-id")) {
            featureItem = target;
            break;
        }
        target = target.parentNode;
    }

    if (featureItem) {
        const id = featureItem.getAttribute("data-feature-id");

        const fullText = featureItem.innerText || "";
        const match = fullText.match(/Primitive\s+(\d+)/i);
        const primitiveId = match ? parseInt(match[1], 10) : null;

        console.log("Clicked feature ID:", id);
        console.log("Primitive ID (if any):", primitiveId);

        if (id) startZoomAnimation(id, primitiveId);
    } else {
        console.warn("No feature ID found in clicked element.");
    }
});
}   