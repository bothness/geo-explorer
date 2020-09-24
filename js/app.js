const globals = {
  maxzoom: 15,
  apigeo: 'https://pmd3-production-drafter-onsgeo.publishmydata.com/v1/sparql/live?query=',
  apicogs: 'https://staging.gss-data.org.uk/sparql?query='
}

const layers = [
  {
    name: "country",
    type: "geojson",
    label: "Countries",
    groups: ["E92", "W92"],
    count: 2,
    data: "./data/country.geojson",
    minzoom: 0,
    maxzoom: 5,
    attribution: "ONS"
  },
  {
    name: "region",
    type: "geojson",
    label: "Regions",
    count: 9,
    groups: ["E12"],
    data: "./data/region.geojson",
    minzoom: 5,
    maxzoom: 7,
    attribution: "ONS"
  },
  {
    name: "cmlad",
    type: "geojson",
    label: "Local Authorities",
    groups: ["E06", "E07", "E08", "E09", "W06"],
    count: 348,
    data: "./data/lad.geojson",
    minzoom: 7,
    maxzoom: 10,
    attribution: "ONS"
  },
  {
    name: "msoa",
    type: "vector",
    label: "MSOAs",
    groups: ["E02", "W02"],
    count: 7201,
    tiles: [
      "https://cdn.ons.gov.uk/maptiles/t25/boundaries/{z}/{x}/{y}.pbf"
    ],
    minzoom: 10,
    maxzoom: 12,
    attribution: "ONS",
    layer: { "boundaries": "msoa11cd" }
  },
  {
    name: "lsoa",
    type: "vector",
    label: "LSOAs",
    groups: ["E01", "W01"],
    count: 34753,
    tiles: [
      "https://cdn.ons.gov.uk/maptiles/t26/boundaries/{z}/{x}/{y}.pbf"
    ],
    minzoom: 12,
    maxzoom: 13,
    attribution: "ONS",
    layer: { "boundaries": "lsoa11cd" }
  },
  {
    name: "oa",
    type: "vector",
    label: "Output Areas",
    groups: ["E00", "W00"],
    count: 181408,
    tiles: [
      "https://cdn.ons.gov.uk/maptiles/t9/{z}/{x}/{y}.pbf"
    ],
    minzoom: 13,
    maxzoom: 14,
    attribution: "ONS",
    layer: { "OA_bound_ethnicity": "oa11cd" }
  }
];

// Create code => layer lookup
var allcodes = [];
var lookup = {};
layers.forEach(obj => {
  let source = obj.name;
  let layer = obj.layer ? Object.keys(obj.layer)[0] : null;
  let zoom = (obj.minzoom + obj.maxzoom) / 2;
  obj.groups.forEach(el => {
    allcodes.push(el);
    lookup[el] = {
      source: source,
      layer: layer,
      zoom: zoom
    }
  })
});

// Create array for selector
var select = [];
layers.forEach(obj => {
  let index = select.findIndex(el => el.label === obj.label);
  if (index === -1) {
    select.push({
      name: obj.name,
      label: obj.label,
      count: obj.count,
      zoom: (obj.minzoom + obj.maxzoom) / 2
    });
  } else {
    select[index].count += obj.count;
  }
});

// Index maxzooms
maxzooms = [];
layers.forEach(obj => {
  maxzooms.push([obj.name, obj.maxzoom]);
})

const style = {
  line: {
    layout: {
      "line-cap": "round",
      "line-join": "round",
      "visibility": "visible"
    },
    paint: {
      "line-color": ['case',
        ['==', ['feature-state', 'select'], true], "hsl(0, 0%, 0%)",
        "hsl(0, 0%, 60%)"
      ],
      "line-width": ['case',
        ['==', ['feature-state', 'select'], true], 3,
        ['==', ['feature-state', 'hover'], true], 2,
        1
      ]
    }
  },
  fill: {
    paint: {
      "fill-color": ['case',
        ['==', ['feature-state', 'select'], true], 'rgba(255, 255, 255, 0.75)',
        ['==', ['feature-state', 'hover'], true], 'rgba(255, 255, 255, 0.5)',
        'rgba(255, 255, 255, 0)'
      ]
    }
  }
};

// DOM elements
const selector = document.getElementById('geography');
const geoDiv = document.getElementById('selected');
const searchDiv = document.getElementById('search');
const form = document.getElementById('form');
const postcode = document.getElementById('postcode');
const pcodeName = document.getElementById('code-name');
const pcodeHierarchy = document.getElementById('code-hierarchy');
const geoName = document.getElementById('geo-name');
const geoCode = document.getElementById('geo-code');
const geoGroup = document.getElementById('geo-group');
const geoPop = document.getElementById('geo-pop');
const geoArea = document.getElementById('geo-area');
const geoParents = document.getElementById('geo-parents');
const geoChildren = document.getElementById('geo-children');

// Variables for highlighting hovered and selected areas
var hovered = null;
var selected = null;

// Variables for data
var data = {
  selected: null,
  search: null
};

// Tooltip class for map hover
const tooltip = new mapboxgl.Popup({
  closeButton: false,
  closeOnClick: false
});

// Function to get the center of a polygon
function getCenter(polygon) {
  // Hack: In case polygon is wrapped in an array (ie. when it is part of a multipolygon)
  polygon = polygon.length === 1 ? polygon[0] : polygon;

  let lngs = 0;
  let lats = 0;

  polygon.forEach(lnglat => {
    lngs += lnglat[0];
    lats += lnglat[1];
  });

  return [lngs / polygon.length, lats / polygon.length];
}

// Function to create selector
function makeSelector(select, selector) {
  let html = '';
  select.forEach(el => {
    html += `<option value="${el.name}" data-zoom="${el.zoom}">${el.label} (${el.count.toLocaleString()})</option>`;
  });
  selector.innerHTML = html;

  // Event listener
  selector.onchange = function () {
    map.flyTo({ zoom: +selector.selectedOptions[0].dataset.zoom });
  }
}

// Postcode search function
function postcodeSearch(e) {
  let code = postcode.value.replace(new RegExp(' ', 'g'), '').toUpperCase();
  let query = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
  PREFIX within: <http://statistics.data.gov.uk/def/spatialrelations/within#>
  PREFIX postcode: <http://statistics.data.gov.uk/id/postcode/unit/>
  PREFIX geopos: <http://www.w3.org/2003/01/geo/wgs84_pos#>
    
  SELECT ?postcode ?oa ?lng ?lat
  WHERE {
    postcode:${code} rdfs:label ?postcode ;
                     within:outputarea ?oa_uri ;
                     geopos:lat ?lat ;
                     geopos:long ?lng .
    ?oa_uri rdfs:label ?oa .
  }
  LIMIT 1`;
  let url = globals.apigeo + encodeURIComponent(query);

  fetch(url)
    .then(response => response.text())
    .then(rawdata => d3.csvParse(rawdata))
    .then(json => {
      if (json[0]) {
        data.search = json[0];
        let oa_code = json[0]['oa']

        let parents = `PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
        PREFIX geoid: <http://statistics.data.gov.uk/id/statistical-geography/>
        PREFIX geodef: <http://statistics.data.gov.uk/def/statistical-geography#>
        PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
        
        SELECT ?code ?name
        WHERE {
          geoid:${oa_code} skos:broader+ ?parent .
          ?parent rdfs:label ?code ;
                  geodef:officialname ?name .
        }
        ORDER BY ?code
        LIMIT 20`;
        let url = globals.apicogs + encodeURIComponent(parents);

        fetch(url)
          .then(response => response.text())
          .then(rawdata => d3.csvParse(rawdata))
          .then(json => {
            if (json[0]) {
              json.unshift({
                code: oa_code,
                name: ''
              })
              data.search.parents = json;
            }

            updateSearch(data.search);
          });
      } else {
        postcode.value = null;
        postcode.placeholder = "Not found. Type a postcode...";
      }
    });
  e.preventDefault();
}

// Update the data in the search box
function updateSearch(json) {
  let html = '';

  // Turn parents into a hierarchy
  if (json.parents) {
    let codes = [];
    let hierarchy = [];

    json.parents.forEach(el => {
      codes.push(el.code.substring(0, 3));
    });

    layers.forEach(el => {
      el.groups.forEach(grp => {
        let index = codes.findIndex(code => code === grp);
        if (index != -1) {
          hierarchy.push(json.parents[index]);
        }
      });
    });
    html = makeHierarchy(hierarchy);
  }

  pcodeName.innerHTML = json.postcode;
  pcodeHierarchy.innerHTML = html;
  geoDiv.style.display = 'none';
  searchDiv.style.display = 'block';

  marker.setLngLat([json.lng, json.lat]);
  map.flyTo({
    center: [json.lng, json.lat],
    zoom: 15
  });
}

// Update the data for the selected location
function updateData(json) {
  geoName.innerHTML = json.name;
  geoCode.innerHTML = json.code;
  geoGroup.innerHTML = json.group_code + ' ' + json.group;
  geoArea.innerHTML = Number(json.area).toLocaleString() + ' hectares';
  geoPop.innerHTML = Number(json.population).toLocaleString() + ' persons <small class="text-muted">(2011)</small>';
  let children = '';
  let parents = '';

  // Return list of children
  if (json.children) {
    for (var i = 0; i < json.children.length; i++) {
      let code = json.children[i].code;
      let group = code.substring(0, 3);
      if (allcodes.includes(group)) {
        let name = json.children[i].name != '' ? json.children[i].name : code;
        children += `<a href="#" onclick="navTo('${code}')">${name}</a>, `;
      }
    }
  }

  // Turn parents into a hierarchy
  if (json.parents) {
    let codes = [];
    let hierarchy = [];

    json.parents.forEach(el => {
      codes.push(el.code.substring(0, 3));
    });

    layers.forEach(el => {
      el.groups.forEach(grp => {
        let index = codes.findIndex(code => code === grp);
        if (index != -1) {
          hierarchy.push(json.parents[index]);
        }
      });
    });
    parents = makeHierarchy(hierarchy);
  }

  geoParents.innerHTML = parents;
  geoChildren.innerHTML = children;
  searchDiv.style.display = 'none';
  geoDiv.style.display = 'block';
}

// Function to make a hierarchy from a sorted array
function makeHierarchy(array) {
  let html = '';
  let count = -1;

  array.forEach(el => {
    let name = el.name != '' ? el.name : el.code;
    if (count >= 0) {
      html += `<i class="material-icons small" style="padding-left: ${count * 10}px;">subdirectory_arrow_right</i>`;
    }
    html += `<a href="#" onclick="navTo('${el.code}')">${name}</a><br/>`;
    count += 1;
  });

  return html;
}

// Function to get data for a geography
function getData(code) {
  let group = code.substring(0, 3);
  let query = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
  PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
  PREFIX statid: <http://statistics.data.gov.uk/id/statistical-geography/>
  PREFIX area: <http://statistics.data.gov.uk/def/measurement#>
  PREFIX entity: <http://statistics.data.gov.uk/def/statistical-entity#>
    
  SELECT ?code ?name ?group_code ?group ?area
  WHERE {
    statid:${code} rdfs:label ?code ;
                      entity:code ?grp ;
                      area:hasExtentOfTheRealmHectarage ?area .
    ?grp rdfs:label ?group_code ;
         entity:name ?group .
    OPTIONAL {
      statid:${code} skos:prefLabel ?name .
    } .
  }
  LIMIT 1`;
  let children = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
  PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
  PREFIX geoid: <http://statistics.data.gov.uk/id/statistical-geography/>
  PREFIX geodef: <http://statistics.data.gov.uk/def/statistical-geography#>
  
  SELECT ?code ?name
  WHERE {
    ?child skos:broader geoid:${code} ;
           rdfs:label ?code .
    OPTIONAL {
      ?child geodef:officialname ?name .
    }
  }
  ORDER BY ?code
  LIMIT 50`;
  let parents = `PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
  PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
  PREFIX geoid: <http://statistics.data.gov.uk/id/statistical-geography/>
  PREFIX geodef: <http://statistics.data.gov.uk/def/statistical-geography#>
  
  SELECT ?code ?name
  WHERE {
    geoid:${code} skos:broader+ ?parent .
    ?parent rdfs:label ?code ;
            geodef:officialname ?name .
  }
  LIMIT 15`;
  let pop1 = `PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
  PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
  PREFIX cube: <http://purl.org/linked-data/cube#>
  PREFIX level: <http://gss-data.org.uk/def/geography/level/>
  PREFIX census11: <http://gss-data.org.uk/data/gss_data/census-2011#>
  PREFIX census11dim: <http://gss-data.org.uk/data/gss_data/census-2011#dimension/>
  PREFIX measure: <http://gss-data.org.uk/def/measure/>
  
  SELECT (SUM(?count) AS ?population)
  WHERE {
    ?geography rdfs:label "${code}" ;
               skos:narrower+ ?child .
    ?child a level:E00 .
    ?dimension census11dim:geography ?child ;
               cube:dataSet census11:dataset ;
               measure:count ?count .
  }
  GROUP BY ?geography
  LIMIT 1`;
  let pop2 = `PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
  PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
  PREFIX cube: <http://purl.org/linked-data/cube#>
  PREFIX census11: <http://gss-data.org.uk/data/gss_data/census-2011#>
  PREFIX census11dim: <http://gss-data.org.uk/data/gss_data/census-2011#dimension/>
  PREFIX measure: <http://gss-data.org.uk/def/measure/>
  
  SELECT (SUM(?count) AS ?population)
  WHERE {
    ?geography rdfs:label "${code}" .
    ?dimension census11dim:geography ?geography ;
               cube:dataSet census11:dataset ;
               measure:count ?count .
  }
  GROUP BY ?geography
  LIMIT 1`;

  let url = globals.apicogs + encodeURIComponent(query);
  let url2 = globals.apicogs + encodeURIComponent(children);
  let url3 = globals.apicogs + encodeURIComponent(parents);
  let url4 = lookup[group]['source'] == 'oa' ? globals.apicogs + encodeURIComponent(pop2) : globals.apicogs + encodeURIComponent(pop1);

  // Get geodata
  fetch(url)
    .then(response => response.text())
    .then(rawdata => d3.csvParse(rawdata))
    .then(json => {
      if (json[0]) {
        data.selected = json[0];

        // let centroid = data.selected.centroid.split(' ');
        // data.selected.lng = +centroid[1].replace('(', '');
        // sdata.selected.lat = +centroid[2].replace(')', '');

        // Get children
        fetch(url2)
          .then(response => response.text())
          .then(rawdata => d3.csvParse(rawdata))
          .then(json => {
            if (json[0]) {
              data.selected.children = json;
            }

            // Get parents
            fetch(url3)
              .then(response => response.text())
              .then(rawdata => d3.csvParse(rawdata))
              .then(json => {
                if (json[0]) {
                  data.selected.parents = json;
                }

                // Get population
                fetch(url4)
                  .then(response => response.text())
                  .then(rawdata => d3.csvParse(rawdata))
                  .then(json => {
                    if (json[0]) {
                      data.selected.population = json[0]['population'];
                    }

                    updateData(data.selected);
                  });
              });
          });
      }
    });
}

// Function to turn a div on or off
function toggleDiv(div) {
  div.style.display = div.style.display == 'block' ? 'none' : 'block';
}

// Navigate to a geography
function navTo(code) {
  let group = code.substring(0, 3);
  let geography = lookup[group];
  if (selected) {
    map.setFeatureState(
      { source: selected.source, sourceLayer: selected.layer, id: selected.id },
      { select: false }
    );
  }
  selected = {
    source: geography.source,
    layer: geography.layer,
    id: code
  };
  map.setFeatureState(
    { source: selected.source, sourceLayer: selected.layer, id: selected.id },
    { select: true }
  );

  getData(selected.id);

  map.flyTo({
    zoom: geography.zoom
  });
}

// Function to add map boundaries
// NOTE: Final version should have a single vector tile source for the map boundaries
function addLayers() {

  for (i in layers) {
    if (layers[i].type === "vector") {

      // Add vector tile layers
      map.addSource(layers[i].name, {
        "type": layers[i].type,
        "promoteId": layers[i].layer,
        "tiles": layers[i].tiles,
        "minzoom": layers[i].minzoom,
        "maxzoom": layers[i].maxzoom
      });

      map.addLayer({
        id: layers[i].name + '_line',
        type: 'line',
        source: layers[i].name,
        'source-layer': Object.keys(layers[i].layer)[0],
        layout: style.line.layout,
        paint: style.line.paint,
        minzoom: layers[i].minzoom,
        maxzoom: layers[i].maxzoom >= 14 ? globals.maxzoom + 1 : layers[i].maxzoom + 0.999
      }, 'boundary_country');

      map.addLayer({
        id: layers[i].name,
        type: 'fill',
        source: layers[i].name,
        'source-layer': Object.keys(layers[i].layer)[0],
        paint: style.fill.paint,
        minzoom: layers[i].minzoom,
        maxzoom: layers[i].maxzoom >= 14 ? globals.maxzoom + 1 : layers[i].maxzoom + 0.999
      }, layers[i].name + '_line');

    } else {

      // Add geojson layers
      map.addSource(layers[i].name, {
        "type": layers[i].type,
        "data": layers[i].data,
        "promoteId": "item"
      });

      map.addLayer({
        id: layers[i].name,
        type: 'fill',
        source: layers[i].name,
        paint: style.fill.paint,
        minzoom: layers[i].minzoom,
        maxzoom: layers[i].maxzoom >= 14 ? globals.maxzoom + 1 : layers[i].maxzoom + 0.999
      }, 'boundary_country');

      map.addLayer({
        id: layers[i].name + '_line',
        type: 'line',
        source: layers[i].name,
        layout: style.line.layout,
        paint: style.line.paint,
        minzoom: layers[i].minzoom,
        maxzoom: layers[i].maxzoom >= 14 ? globals.maxzoom + 1 : layers[i].maxzoom + 0.999
      }, layers[i].name);
    }

    // Highlight on hover
    map.on('mousemove', layers[i].name, (e) => {
      if (e.features.length > 0) {
        if (hovered) {
          map.setFeatureState(
            { source: hovered.source, sourceLayer: hovered.layer, id: hovered.id },
            { hover: false }
          );
        }
        hovered = {
          source: e.features[0].layer.source,
          layer: e.features[0].layer['source-layer'],
          id: e.features[0].id
        };
        map.setFeatureState(
          { source: hovered.source, sourceLayer: hovered.layer, id: hovered.id },
          { hover: true }
        );

        // Change the cursor style as a UI indicator.
        map.getCanvas().style.cursor = 'pointer';

        // Show tooltip
        tooltip
          .setLngLat(e.lngLat)
          .setHTML(`<strong>${hovered.id}</strong>`)
          .addTo(map);
      }
    });

    // Un-highlight on mouseleave
    map.on('mouseleave', layers[i].name, (e) => {
      if (hovered) {
        map.setFeatureState(
          { source: hovered.source, sourceLayer: hovered.layer, id: hovered.id },
          { hover: false }
        );
      }
      hovered = null;

      map.getCanvas().style.cursor = '';
      tooltip.remove();
    });

    // Select on click
    map.on('click', layers[i].name, (e) => {
      if (e.features.length > 0) {
        if (selected) {
          map.setFeatureState(
            { source: selected.source, sourceLayer: selected.layer, id: selected.id },
            { select: false }
          );
        }
        selected = {
          source: e.features[0].layer.source,
          layer: e.features[0].layer['source-layer'],
          id: e.features[0].id
        };
        map.setFeatureState(
          { source: selected.source, sourceLayer: selected.layer, id: selected.id },
          { select: true }
        );

        getData(selected.id);

        map.flyTo({
          center: getCenter(e.features[0].geometry.coordinates[0])
        });
      }
    });
  }
}

function setSelector() {
  let zoom = map.getZoom();
  for (var i = 0; i < maxzooms.length; i++) {
    if (zoom < maxzooms[i][1]) {
      selector.value = maxzooms[i][0];
      break;
    }
  }
}

var map = new mapboxgl.Map({
  container: 'map',
  style: './data/style-omt.json',
  bounds: [[-5.816, 49.864], [1.863, 55.872]],
  minZoom: 4,
  maxZoom: globals.maxzoom,
  attributionControl: false
});

map.addControl(
  new mapboxgl.NavigationControl({
    showCompass: false
  }),
  'top-right'
);

// Add default marker to map
const marker = new mapboxgl.Marker()
  .setLngLat([0, 0])
  .addTo(map);

map.on('load', function () {
  addLayers();
  setSelector();
});

map.on('zoom', function () {
  setSelector();
});

// Create geography selector
makeSelector(select, selector);

// Set event listener on postcode search
form.addEventListener('submit', postcodeSearch);