# iitbmap

A MapLibre GL JS style + geo data for the IIT Bombay campus map.

http://iitb-oss.github.io/iitbmap

## Install

For local development against another project:

```bash
npm install /path/to/iitbmap   # or: "iitbmap": "file:../iitbmap" in package.json
```

## Usage

```ts
import maplibregl from "maplibre-gl";
import { getCampusStyle, CAMPUS_BOUNDS } from "iitbmap";

const map = new maplibregl.Map({
  container: "map",
  style: getCampusStyle({
    dark: false,
    tileUrl: "https://<your-r2-host>/v1/tiles/{z}/{x}/{y}.pbf",
    glyphsUrl: "https://<your-r2-host>/v1/fonts/{fontstack}/{range}.pbf",
  }),
  bounds: CAMPUS_BOUNDS,
});
```

Already have your own base style? Splice the campus layers into it instead:

```ts
import { mergeCampusLayers } from "iitbmap";
const style = mergeCampusLayers(myBaseStyle, { tileUrl, glyphsUrl, beforeId: "my-markers" });
```

Toggling dark mode on an already-rendered map:

```ts
import { setCampusTheme } from "iitbmap";
setCampusTheme(map, dark);
```

