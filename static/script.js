let gmlDoc = null;
let jsonDoc = null;
let jsonBlob = null;
const focusMap = {};
let selectedID = null;
let selectedOBJ = null;
let choosenProfile = null;
let uploadedContent = null;

async function loadShaclIds() {
    try {
        const response = await fetch('/3dinteractivevalidation/process-ids');
        if (!response.ok) {
            throw new Error(`Server error: ${response.statusText}`);
        }

        const ids = await response.json();
        const dropdown = document.getElementById('shaclDropdown');

        dropdown.innerHTML = '<option disabled selected>Choose a profile</option>';

        ids.forEach(id => {
            const option = document.createElement('option');
            option.value = id;
            option.textContent = id;
            dropdown.appendChild(option);
        });
    } catch (error) {
        alert("Cannot catch IDs: " + error.message);
    }
}

function saveSelectedId(selectElement) {
    choosenProfile = selectElement.value;
    console.log("Choosen ID:", choosenProfile);
}

document.getElementById('shaclUpload').addEventListener('change', function (e) {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = function (event) {
        uploadedContent = event.target.result;
        console.log("✅ SHACL content readed:", uploadedContent.slice(0, 50) + '...');
    };
    reader.readAsText(file);
});

document.getElementById('shaclFile').addEventListener('click', async () => {
    if (!jsonDoc) {
        console.log("jsonDoc is not set, showing alert");
        alert("Please upload a CityJSON file first.");
        return;
    }
    document.getElementById("focusNodeLoading").style.display = "flex";

    const hasSelectedProfile = choosenProfile && choosenProfile.trim() !== "";
    const hasUploadedShacl = uploadedContent && uploadedContent.trim() !== "";

    let profileIdToUse = "_shaclValidation";
    let profileContentsToUse = null;

    if (hasSelectedProfile) {
        profileIdToUse = choosenProfile;
    } else if (hasUploadedShacl) {
        profileContentsToUse = uploadedContent;
    }
    try {
        const response = await fetch('/3dinteractivevalidation/proxy/validate/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                cityjson: JSON.stringify(jsonDoc),
                profileId: profileIdToUse,
                profileContents: profileContentsToUse
            })
        });

        if (!response.ok) throw new Error("Validation failed: " + response.statusText);
        if (response.ok) {
            document.getElementById("focusNodeLoading").style.display = "none";
        }
        const parsed = await response.json();
        const results = parsed?.shaclReport?.result || [];
        const fileValidation = parsed?.fileValidation;

        renderValidationSummary(fileValidation);
        Object.keys(focusMap).forEach(k => delete focusMap[k]);

        results.forEach(res => {
            const nodeFull = res.focusNode;
            const nodeFullStr = typeof nodeFull === 'string' ? nodeFull : nodeFull?.['@id'] || '';
            const nodeIdMatch = nodeFullStr.match(/ID_\d+_\d+/);
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

    } catch (err) {
        console.error("Validation failed:", err);
        alert("Validation failed. See console for details.");
    }
});

document.getElementById('viewProcess').addEventListener('click', e => {
    if (!jsonDoc) {
        alert("Please upload a CityGML or CityJSON file first.");
        return;
    }

    const formData = new FormData();
    jsonBlob = new Blob([JSON.stringify(jsonDoc)], { type: 'application/json' });

    formData.append('file', jsonBlob);
    fetch('/3dinteractivevalidation/visualize', {
        method: 'POST',
        body: formData
    })
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok: ' + response.statusText);
            }
            return response.json();
        })
        .then(data => {
            // Dynamically construct the absolute URL
            const glbFileName = data.response;
            const baseUrl = `${window.location.protocol}//${window.location.host}`;
            const glbUrl = `${baseUrl}/3dinteractivevalidation/download/${glbFileName}`;

            console.log("Constructed GLB URL:", glbUrl); // Debugging
            viewWhole(glbUrl);

        })
        .catch(error => {
            console.error('There was a problem with the fetch operation:', error);
            alert("Error: " + error.message);
        });
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
        if (file.name.endsWith('.gml')) {
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

    const CityObjects = jsonDoc.CityObjects;

    // Helper: try finding attribute on a CityObject (attributes or its surfaces)
    function findOnCityObject(cid) {
        const co = CityObjects[cid];
        if (!co) return null;

        // 1) check top-level attributes
        if (co.attributes && Object.prototype.hasOwnProperty.call(co.attributes, attrName)) {
            return { value: co.attributes[attrName], gmlId: cid };
        }

        // 2) check surfaces in geometries
        if (Array.isArray(co.geometry)) {
            for (const geom of co.geometry) {
                const surfaces = geom?.semantics?.surfaces;
                if (!Array.isArray(surfaces)) continue;

                for (const surface of surfaces) {
                    if (surface && Object.prototype.hasOwnProperty.call(surface, attrName)) {
                        // prefer returning surface id when available, otherwise return parent CityObject id
                        return { value: surface[attrName], gmlId: surface.id || cid };
                    }
                }
            }
        }

        return null;
    }

    // Helper: walk parents upward for fallback lookup
    function walkParentsAndFind(startCid, visited = new Set()) {
        if (!startCid || visited.has(startCid)) return null;
        visited.add(startCid);

        const res = findOnCityObject(startCid);
        if (res) return res;

        const co = CityObjects[startCid];
        if (co && Array.isArray(co.parents)) {
            for (const p of co.parents) {
                const up = walkParentsAndFind(p, visited);
                if (up) return up;
            }
        }
        return null;
    }

    // 1) If objectId matches a CityObject id
    if (CityObjects[objectId]) {
        const direct = findOnCityObject(objectId);
        if (direct) return direct;

        // fallback: children (geometry of children may contain attribute)
        const co = CityObjects[objectId];
        if (co && Array.isArray(co.children)) {
            for (const childId of co.children) {
                const fromChild = walkParentsAndFind(childId);
                if (fromChild) return fromChild;
            }
        }

        // fallback: walk parents of this object
        const up = walkParentsAndFind(objectId);
        if (up) return up;
    }

    // 2) If objectId does not match a CityObject id, treat it as a possible surface id
    for (const [cid, co] of Object.entries(CityObjects)) {
        if (!co || !Array.isArray(co.geometry)) continue;

        for (const geom of co.geometry) {
            const surfaces = geom?.semantics?.surfaces;
            if (!Array.isArray(surfaces)) continue;

            for (const surface of surfaces) {
                if (!surface) continue;

                if (surface.id === objectId) {
                    // found the surface
                    if (Object.prototype.hasOwnProperty.call(surface, attrName)) {
                        return { value: surface[attrName], gmlId: surface.id || cid };
                    }

                    // if attribute not on surface, check parent CityObject attributes and parents chain
                    if (co.attributes && Object.prototype.hasOwnProperty.call(co.attributes, attrName)) {
                        return { value: co.attributes[attrName], gmlId: cid };
                    }

                    const up = walkParentsAndFind(cid);
                    if (up) return up;
                }
            }
        }
    }

    return null;
}

function showGmlAttributes(gmlId, violation) {
    const output = document.getElementById('gmlDetails');
    output.innerHTML = '';
    const rawPath = violation?.resultPath?.[0] || null;
    let pathVar = rawPath?.includes('#') ? rawPath.split('#').pop() : rawPath;
    if (pathVar === '') pathVar = null;

    if (!gmlDoc && !jsonDoc) {
        alert('Please upload a CityGML or CityJSON file first.');
        return;
    }

    const rows = []; // each row: { attr, value, source }

    // GML lookup when available and path given
    if (gmlDoc && pathVar) {
        const allElements = gmlDoc.getElementsByTagName('*');
        let matchedElement = null;
        for (const el of allElements) {
            const id = el.getAttributeNS('http://www.opengis.net/gml', 'id') || el.getAttribute('gml:id') || el.getAttribute('id');
            if (id === gmlId) { matchedElement = el; break; }
        }
        if (matchedElement) {
            const res = deepFindValueGML(matchedElement, pathVar);
            if (res && 'value' in res) rows.push({ attr: pathVar, value: res.value, source: res.gmlId || gmlId });
        }
    }

    // CityJSON lookup and inference
    if (jsonDoc) {
        // build candidate attribute names
        function generateAttrCandidates(p) {
            const c = new Set();
            if (p) c.add(p);
            if (p && p.includes('#')) c.add(p.split('#').pop());
            if (p && p.includes('/')) c.add(p.split('/').pop());
            if (p && p.includes('.')) c.add(p.split('.').pop());
            if (p) c.add(p.replace(/^.*attributes[\/\.:]?/, ''));
            if (p) c.add(p.replace(/^.*properties[\/\.:]?/, ''));
            return Array.from(c).filter(x => x && x.trim() !== '');
        }

        const tried = new Set();
        const candidates = generateAttrCandidates(pathVar);
        for (const cand of candidates) {
            if (tried.has(cand)) continue;
            tried.add(cand);
            const found = deepFindValueCityJSON(gmlId, cand);
            if (found && 'value' in found) rows.push({ attr: cand, value: found.value, source: found.gmlId || gmlId });
        }

        // final raw attempt
        if (rawPath && !tried.has(rawPath)) {
            const found = deepFindValueCityJSON(gmlId, rawPath);
            if (found && 'value' in found) rows.push({ attr: rawPath, value: found.value, source: found.gmlId || gmlId });
        }

        // If still nothing, try to infer or list available attributes on the CityObject
        if (rows.length === 0) {
            try {
                const co = jsonDoc.CityObjects?.[gmlId];
                if (co) {
                    // list CityObject attributes
                    if (co.attributes) {
                        for (const [k, v] of Object.entries(co.attributes)) {
                            rows.push({ attr: k, value: v, source: gmlId });
                        }
                    }

                    // list surface-level attributes (first geometry block)
                    if (Array.isArray(co.geometry)) {
                        for (const geom of co.geometry) {
                            const surfaces = geom?.semantics?.surfaces;
                            if (!Array.isArray(surfaces)) continue;
                            for (const s of surfaces) {
                                if (!s) continue;
                                for (const [k, v] of Object.entries(s)) {
                                    if (['type', 'id', 'parent', 'children'].includes(k)) continue;
                                    rows.push({ attr: k, value: v, source: s.id || gmlId });
                                }
                            }
                        }
                    }
                } else {
                    // objectId might be a surface id: scan all CityObjects to find surface
                    for (const [cid, co2] of Object.entries(jsonDoc.CityObjects || {})) {
                        if (!co2 || !Array.isArray(co2.geometry)) continue;
                        let matched = false;
                        for (const geom of co2.geometry) {
                            const surfaces = geom?.semantics?.surfaces;
                            if (!Array.isArray(surfaces)) continue;
                            for (const s of surfaces) {
                                if (s?.id === gmlId) {
                                    for (const [k, v] of Object.entries(s)) {
                                        if (['type', 'id', 'parent', 'children'].includes(k)) continue;
                                        rows.push({ attr: k, value: v, source: s.id });
                                    }
                                    matched = true; break;
                                }
                            }
                            if (matched) break;
                        }
                        if (matched) break;
                    }
                }
            } catch (e) {
                console.warn('Attribute inference failed', e);
            }
        }
    }

    // Render simple attributes table (no desired/threshold logic)
    let html = '';
    if (rows.length > 0) {
        html += '<div style="max-height:300px;overflow:auto;">';
        html += '<table><tr><th>Attribute</th><th>Value</th><th>Source gml:id</th></tr>';
        const seen = new Set();
        for (const r of rows) {
            const key = `${r.attr}||${r.source}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const displayValue = (r.value === null || r.value === undefined) ? '<i>null</i>' : String(r.value);
            html += `<tr><td>${r.attr}</td><td>${displayValue}</td><td>${r.source || '-'}</td></tr>`;
        }
        html += '</table></div>';
    } else {
        html = '<div>Attribute can not be found.</div>';
    }

    output.innerHTML = html;
}

function viewWhole(glbdata) {
    const container = document.getElementById('modelViewer');
    // Clear previous viewer if re-running
    container.innerHTML = '';

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

    // =========================================================================
    // HYBRID LOGIC: Structural Metadata Mapping & Batched Triangle Extraction
    // =========================================================================
    let featureIdMap = {}; // Maps string IDs (e.g., "ID_25896_0") to integer Feature IDs (e.g., 5)
    let currentHighlightMesh = null; // Keeps track of the red extracted mesh

    // Extracts the string-to-integer mapping hidden inside the GLB's binary buffers
    async function buildFeatureIdMap(gltf) {
        const map = {};
        try {
            const json = gltf.parser.json;
            const ext = json.extensions?.EXT_structural_metadata;
            if (ext && ext.propertyTables && ext.propertyTables.length > 0) {
                const table = ext.propertyTables[0];
                if (table.properties && table.properties.OBJ_ID) {
                    const valuesViewIndex = table.properties.OBJ_ID.values;
                    const offsetsViewIndex = table.properties.OBJ_ID.stringOffsets;

                    // Fetch the raw binary data for the strings from the GLTF parser
                    const valuesView = await gltf.parser.getDependency('bufferView', valuesViewIndex);
                    const offsetsView = await gltf.parser.getDependency('bufferView', offsetsViewIndex);

                    const offsetsArray = new Uint32Array(offsetsView);
                    const valuesArray = new Uint8Array(valuesView);
                    const decoder = new TextDecoder('utf-8');

                    // Decode the strings and map them to their integer index
                    for (let i = 0; i < offsetsArray.length - 1; i++) {
                        const start = offsetsArray[i];
                        const end = offsetsArray[i + 1];
                        const stringBytes = valuesArray.subarray(start, end);
                        const str = decoder.decode(stringBytes);
                        map[str] = i; 
                    }
                }
            }
        } catch (e) {
            console.warn("Could not parse EXT_structural_metadata from GLB buffers:", e);
        }

        // Fallback: If metadata parsing fails, map using the CityJSON Object Index
        if (Object.keys(map).length === 0 && jsonDoc && jsonDoc.CityObjects) {
            let i = 0;
            for (const key of Object.keys(jsonDoc.CityObjects)) {
                map[key] = i;
                i++;
            }
        }
        return map;
    }

    // Extracts specific triangles from the giant batched mesh and creates a highlight mesh
    function highlightBatchedFeature(batchedMesh, targetFeatureId) {
        const geometry = batchedMesh.geometry;
        const position = geometry.attributes.position;
        
        const attrs = geometry.attributes;
        const featureIdKey = Object.keys(attrs).find(k => 
            k.toLowerCase().includes('feature_id') || 
            k.toLowerCase().includes('batchid') || 
            k.toLowerCase().includes('objectid')
        );

        if (!featureIdKey) return null;

        const featureIds = attrs[featureIdKey];
        const targetId = Number(targetFeatureId); 
        const highlightPositions = [];
        let matchCount = 0;

        // Determine if this is a Mesh (3 vertices), Line (2 vertices), or Point (1 vertex)
        const isLines = batchedMesh.isLine || batchedMesh.isLineSegments;
        const isPoints = batchedMesh.isPoints;
        const stride = isLines ? 2 : (isPoints ? 1 : 3);

        if (geometry.index) {
            const index = geometry.index;
            for (let i = 0; i < index.count; i += stride) {
                const a = index.getX(i);
                
                if (Math.round(featureIds.getX(a)) === targetId) {
                    matchCount++;
                    highlightPositions.push(position.getX(a), position.getY(a), position.getZ(a));
                    if (stride >= 2) {
                        const b = index.getX(i+1);
                        highlightPositions.push(position.getX(b), position.getY(b), position.getZ(b));
                    }
                    if (stride === 3) {
                        const c = index.getX(i+2);
                        highlightPositions.push(position.getX(c), position.getY(c), position.getZ(c));
                    }
                }
            }
        } else {
            for (let i = 0; i < position.count; i += stride) {
                if (Math.round(featureIds.getX(i)) === targetId) {
                    matchCount++;
                    for (let j = 0; j < stride; j++) {
                        highlightPositions.push(position.getX(i+j), position.getY(i+j), position.getZ(i+j));
                    }
                }
            }
        }

        if (matchCount === 0) return null; // Not in this object, check the next one

        // Create the new standalone red geometry
        const highlightGeo = new THREE.BufferGeometry();
        highlightGeo.setAttribute('position', new THREE.Float32BufferAttribute(highlightPositions, 3));

        let newHighlight;
        if (isLines) {
            const mat = new THREE.LineBasicMaterial({ color: 0xf44336, depthTest: false, linewidth: 2 });
            newHighlight = new THREE.LineSegments(highlightGeo, mat);
        } else if (isPoints) {
            const mat = new THREE.PointsMaterial({ color: 0xf44336, size: 0.5, depthTest: false });
            newHighlight = new THREE.Points(highlightGeo, mat);
        } else {
            const mat = new THREE.MeshStandardMaterial({
                color: 0xf44336, transparent: false, opacity: 1.0, depthTest: true, side: THREE.DoubleSide,
                polygonOffset: true, polygonOffsetFactor: -0.1, polygonOffsetUnits: -1.0
            });
            newHighlight = new THREE.Mesh(highlightGeo, mat);
            // Add black edges to the highlight mesh
            const edgesGeometry = new THREE.EdgesGeometry(highlightGeo);
            const edgesMaterial = new THREE.LineBasicMaterial({ color: 0xf44336, depthTest: false, linewidth: 1 });
            const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
            newHighlight.add(edges);
        }

        newHighlight.position.copy(batchedMesh.position);
        newHighlight.rotation.copy(batchedMesh.rotation);
        newHighlight.scale.copy(batchedMesh.scale);

        // Add to the same parent to inherit transforms (e.g., model scale)
        batchedMesh.parent.add(newHighlight);
        return newHighlight;
    }

    // =========================================================================
    // AGGRESSIVE STANDARD / FALLBACK LOGIC
    // =========================================================================
    function findObjectByNameOrUUID(model, id) {
        let targetObject = null;
        const cleanId = String(id).trim();

        model.traverse((child) => {
            if (targetObject) return; // Stop if already found

            let isMatch = false;

            // 1. Direct Name or UUID match
            if ((child.name && child.name.includes(cleanId)) || child.uuid === cleanId) {
                isMatch = true;
            }

            // 2. Deep Search in userData
            if (!isMatch && child.userData) {
                // Common explicit keys
                if (child.userData.id === cleanId || 
                    child.userData.name === cleanId || 
                    child.userData.OBJ_ID === cleanId ||
                    child.userData.gmlid === cleanId ||
                    child.userData.CityObjectId === cleanId) {
                    isMatch = true;
                } else {
                    // Aggressive nested JSON scan
                    try {
                        const userDataString = JSON.stringify(child.userData);
                        if (userDataString.includes(`"${cleanId}"`) || userDataString.includes(`'${cleanId}'`)) {
                            isMatch = true;
                        }
                    } catch (e) {
                        // Ignore circular reference errors
                    }
                }
            }

            // 3. Ensure we return a renderable mesh
            if (isMatch) {
                if (child.isMesh) {
                    targetObject = child;
                } else {
                    // If matched object is a Group, find the first mesh inside it
                    let firstMesh = null;
                    child.traverse((descendant) => {
                        if (!firstMesh && descendant.isMesh) {
                            firstMesh = descendant;
                        }
                    });
                    targetObject = firstMesh || child;
                }
            }
        });

        return targetObject;
    }

    function findRenderableFallbackID(missingId, primitiveId = null) {
        if (!jsonDoc || !jsonDoc.CityObjects) return null;
        const CityObjects = jsonDoc.CityObjects;
        const obj = CityObjects[missingId];

        if (obj?.children && primitiveId != null) {
            for (const childId of obj.children) {
                const child = CityObjects[childId];
                if (!child?.geometry) continue;
                for (const geom of child.geometry) {
                    const surfaces = geom?.semantics?.surfaces || [];
                    for (let i = 0; i < surfaces.length; i++) {
                        if (surfaces[i]?.id && i === primitiveId) {
                            if (featureIdMap[childId] !== undefined || findObjectByNameOrUUID(scene, childId)) {
                                return childId;
                            }
                        }
                    }
                }
            }
        }

        if (obj?.children) {
            for (const childId of obj.children) {
                if (featureIdMap[childId] !== undefined || findObjectByNameOrUUID(scene, childId)) return childId;
            }
        }
        return null;
    }

    // Load the GLB model
    const loader = new THREE.GLTFLoader();
    loader.load(
        glbdata,
        async function (gltf) {
            // Build our mapping dictionary right when the file loads
            featureIdMap = await buildFeatureIdMap(gltf);
            
            // Log to ensure map is building correctly
            console.log("Feature ID Map created:", featureIdMap);
            
            const model = gltf.scene;
            scene.add(model);

            const box = new THREE.Box3().setFromObject(model);
            const center = box.getCenter(new THREE.Vector3());
            const size = box.getSize(new THREE.Vector3());
            const maxDim = Math.max(size.x, size.y, size.z);

            model.traverse(child => {
                if (child.isMesh && child.geometry) {
                    child.geometry.translate(-center.x, -center.y, -center.z);
                    // Add edges to original meshes
                    const edgesGeometry = new THREE.EdgesGeometry(child.geometry);
                    const edgesMaterial = new THREE.LineBasicMaterial({ color: 0x000000 });
                    const edges = new THREE.LineSegments(edgesGeometry, edgesMaterial);
                    child.add(edges);
                }
            });

            if (maxDim > 0) {
                const normalizedScale = 10 / maxDim;
                model.scale.set(normalizedScale, normalizedScale, normalizedScale);
            } else {
                model.scale.set(0.1, 0.1, 0.1);
            }

            animate();
        },
        undefined,
        function (error) {
            console.error('An error occurred while loading the GLB file:', error);
        }
    );

    camera.up.set(0, 0, 1);
    camera.position.set(10, 10, 10);

    const controls = new THREE.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = false;
    controls.minDistance = 1;
    controls.maxDistance = 1000;

    let isAutoZooming = false; 
    let previousOBJ = null; 
    let originalMaterials = {}; 

    function animate() {
        requestAnimationFrame(animate);
        controls.update();

        if (selectedOBJ && isAutoZooming) {
            const zoomSpeed = 0.05; 
            const minDistance = 5; 
            const maxDistance = 100; 
            const angleOffset = Math.PI / 6; 

            const boundingBox = new THREE.Box3().setFromObject(selectedOBJ);
            const center = boundingBox.getCenter(new THREE.Vector3());

            controls.target.copy(center);

            const currentDistance = camera.position.distanceTo(center);
            let targetDistance = currentDistance - zoomSpeed;
            targetDistance = Math.max(minDistance, Math.min(maxDistance, targetDistance));

            if (currentDistance <= minDistance) isAutoZooming = false; 

            const direction = center.clone().sub(camera.position).normalize(); 
            const horizontalPosition = direction.clone().multiplyScalar(targetDistance); 
            const verticalOffset = new THREE.Vector3(0, 0, Math.sin(angleOffset) * targetDistance); 
            const newPosition = center.clone().add(horizontalPosition).add(verticalOffset); 

            camera.position.lerp(newPosition, 0.1); 
            camera.lookAt(controls.target);
        }

        renderer.render(scene, camera);
    }

    function startZoomAnimation(id, primitiveId = null) {
        selectedID = id;
        selectedOBJ = null;
        let activeId = selectedID;
        let attempts = 0;
        const maxAttempts = 2; // Prevent infinite loops

        // Reset previous non-batched highlight if any
        if (previousOBJ && originalMaterials[previousOBJ.uuid]) {
            previousOBJ.material = originalMaterials[previousOBJ.uuid];
            delete originalMaterials[previousOBJ.uuid];
        }
        previousOBJ = null;

        // Clean up previous batched highlight globally
        if (currentHighlightMesh) {
            if (currentHighlightMesh.parent) {
                currentHighlightMesh.parent.remove(currentHighlightMesh);
            }
            currentHighlightMesh.geometry.dispose();
            currentHighlightMesh.material.dispose();
            currentHighlightMesh = null;
        }

        while (attempts < maxAttempts) {
            attempts++;
            let featureIdInt = featureIdMap[activeId];

            if (featureIdInt !== undefined) {
                // Collect all possible batched objects (Meshes, Lines, Points)
                let batchedObjects = [];
                scene.traverse(child => {
                    if ((child.isMesh || child.isLine || child.isLineSegments || child.isPoints) && child.geometry && child.geometry.attributes) {
                        const hasFeatureAttr = Object.keys(child.geometry.attributes).some(k => 
                            k.toLowerCase().includes('feature_id') || k.toLowerCase().includes('batchid') || k.toLowerCase().includes('objectid')
                        );
                        if (hasFeatureAttr) batchedObjects.push(child);
                    }
                });

                // Try to highlight from each batched object
                for (const bObj of batchedObjects) {
                    const highlight = highlightBatchedFeature(bObj, featureIdInt);
                    if (highlight) {
                        currentHighlightMesh = highlight;
                        selectedOBJ = currentHighlightMesh;
                        break;
                    }
                }
            }

            if (selectedOBJ) break; // Success, exit loop

            // If batched highlight failed, try fallback to a renderable child/surface
            const fallbackId = findRenderableFallbackID(activeId, primitiveId);
            if (fallbackId && fallbackId !== activeId) {
                console.log(`Fallback to renderable ID: ${fallbackId}`);
                activeId = fallbackId;
                continue; // Retry with the new ID
            } else {
                break; // No fallback available
            }
        }

        // Fallback for older non-batched GLBs (if still not found)
        if (!selectedOBJ) {
            selectedOBJ = findObjectByNameOrUUID(scene, activeId);
            
            if (selectedOBJ && selectedOBJ !== currentHighlightMesh) {
                if (!originalMaterials[selectedOBJ.uuid]) {
                    originalMaterials[selectedOBJ.uuid] = Array.isArray(selectedOBJ.material) 
                        ? selectedOBJ.material.map(m => m.clone()) 
                        : selectedOBJ.material.clone(); 
                }
                
                const highlightMat = new THREE.MeshStandardMaterial({
                    color: 0xf44336, 
                    transparent: false,
                    opacity: 1.0,
                    side: THREE.DoubleSide
                });

                selectedOBJ.material = Array.isArray(selectedOBJ.material) 
                    ? selectedOBJ.material.map(() => highlightMat) 
                    : highlightMat;

                previousOBJ = selectedOBJ;
            }
        }

        if (selectedOBJ) {
            isAutoZooming = true;
            console.log("✅ Successfully found and highlighted:", activeId);
        } else {
            console.warn(`❌ Object with ID "${selectedID}" (tried "${activeId}") could not be highlighted.`);
        }
    }

    // Clean up existing listener before re-adding if viewWhole is called multiple times
    const val3dityElement = document.getElementById("val3dity");
    const newListener = function (event) {
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

            if (id) startZoomAnimation(id, primitiveId);
        }
    };
    
    // Replace old listener to prevent duplicates
    const clone = val3dityElement.cloneNode(true);
    val3dityElement.parentNode.replaceChild(clone, val3dityElement);
    clone.addEventListener("click", newListener);
}