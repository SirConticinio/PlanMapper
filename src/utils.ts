import {
    CoordsReference,
    DataFile,
    EditorSettings,
    FloorIntersection,
    LoadedData,
    MapData,
    RoomData,
    RoomIntersection
} from "./dto";
import {G, Matrix, Path, PathArrayAlias, Rect, Shape, Svg} from "@svgdotjs/svg.js";
// @ts-ignore (No TypeScript types for the library unfortunately)
import {Intersection, ShapeInfo, SvgShapes} from "kld-intersections";
import JSZip from 'jszip';
import { v4 as uuidv4 } from "uuid";
import {getGpsDistance} from "./geodistance.ts";

export type Vector2D = {
    x: number;
    y: number;
}

export type Vector3D = {
    x: number;
    y: number;
    z: number;
}

export type Intersection = {
    status: string
    points: {
        x: number,
        y: number
    }[]
}

export function retrievePointsFromShape(pathData: Shape) : Vector2D[] {
    if (pathData instanceof Path) {
        return retrievePointsFromPath(pathData);
    } else if (pathData instanceof Rect) {
        return retrievePointsFromSquare(pathData)
    } else {
        return [];
    }
}

// used for squares
function retrievePointsFromSquare(shapeData: Rect): Vector2D[] {
    const x = shapeData.x() as number;
    const y = shapeData.y() as number;
    const width = shapeData.width() as number;
    const height = shapeData.height() as number;
    return [
        { x: x, y: y },
        { x: x, y: y + height },
        { x: x + width, y: y + height },
        { x: x + width, y: y },
    ]
}

// used for the map paths
function retrievePointsFromPath(pathData: Path) : Vector2D[] {
    const points: Vector2D[] = []
    let pos: Vector2D = {x: 0, y: 0};

    function rel(x: number, y: number): Vector2D { return {x: pos.x + x, y: pos.y + y}; }
    for (const arr of pathData.array()) {
        // For now we're just gonna handle lines.
        // TODO add support for bezier curves and such?
        switch (arr[0]) {
            case 'M': case 'L': // absolute move to
                pos = {x: arr[1], y: arr[2]};
                points.push(pos);
                break;

            case 'm': case 'l': // relative move to
                pos = rel(arr[1], arr[2]);
                points.push(pos);
                break;

            case 'H': // absolute horizontal line
                pos = {x: arr[1], y: pos.y};
                points.push(pos);
                break;

            case 'h': // relative horizontal line
                pos = rel(arr[1], 0)
                points.push(pos);
                break;

            case 'V': // absolute vertical line
                pos = {x: pos.x, y: arr[1]};
                points.push(pos);
                break;

            case 'v': // relative vertical line
                pos = rel(0, arr[1])
                points.push(pos);
                break;
        }
    }

    return points;
}

function polyCheck(v: Vector2D, p: Vector2D[]): boolean {
    let j = p.length - 1;
    let c = false;
    for (let i = 0; i < p.length; j = i++) {
        if ((p[i].y > v.y) !== (p[j].y > v.y) &&
            v.x < (p[j].x - p[i].x) * (v.y - p[i].y) / (p[j].y - p[i].y) + p[i].x) {
            c = !c;
        }
    }
    return c;
}

function replaceMap(key: unknown, value: unknown) {
    if(value instanceof Map) {
        return Array.from(value.values());
    } else {
        return value;
    }
}

export function settingsToJson(data: EditorSettings) {
    return JSON.stringify(data, replaceMap, 2);
}

export function mapDataToJson(data: MapData) {
    // we're going to create a clone of the data where all the coords are scaled to the center.
    // EDIT: it's easier to work with the original data and not mess with it, let's just pass the scale down to UC3Map and let it handle it
    /*const center = calculateMapCenter(data);
    const scale = calculateScale(data.coordsReferences);
    const newData = {
        ...data,
        rooms: data.rooms.map(room => ({...room, points: room.points.map(point => centerAndScaleVector(point, center, scale))})),
        intersections: data.intersections.map(inter => ({...inter, intersection: centerAndScaleVector(inter.intersection, center, scale)})),
        floorIntersections: data.floorIntersections.map(inter => ({...inter, intersection: centerAndScaleVector(inter.intersection, center, scale)}))
    } as MapData;*/

    // we return the string version of the new data
    return JSON.stringify(data, replaceMap, 2);
}

export function centerAndScaleVector(vector: Vector2D, center: Vector2D, scale: number): Vector2D {
    return { x: (vector.x - center.x) * scale, y: (vector.y - center.y) * scale } as Vector2D;
}

export function calculateMapCenter(mapData: MapData): Vector2D {
    // first we calculate the min and the max corners
    const minPoint: Vector2D = { x: mapData.rooms[0].points[0].x, y: mapData.rooms[0].points[0].y };
    const maxPoint: Vector2D = { x: minPoint.x, y: minPoint.y };
    for (const room of mapData.rooms) {
        for (const point of room.points) {
            if (point.x < minPoint.x) {
                minPoint.x = point.x;
            }
            if (point.y < minPoint.y) {
                minPoint.y = point.y;
            }
            if(point.x > maxPoint.x) {
                maxPoint.x = point.x;
            }
            if (point.y > maxPoint.y) {
                maxPoint.y = point.y;
            }
        }
    }

    // from there, we can calculate the center by averaging them
    return { x: (minPoint.x + maxPoint.x) / 2, y: (minPoint.y + maxPoint.y) / 2 };
}

export function loadMapData(dataFile: DataFile) : MapData {
    const jsonData = JSON.parse(dataFile.data) as MapData;
    console.log(jsonData);
    jsonData.id = jsonData.id ?? uuidv4();
    jsonData.coordsReferences = jsonData.coordsReferences ?? [];
    jsonData.floorIntersections = jsonData.floorIntersections ?? [];
    jsonData.version = jsonData.version ?? 1;
    jsonData.rooms = jsonData.rooms.map(room => room.pathId ? room : {...room, pathId: room.id});
    jsonData.rooms = jsonData.rooms.map(room => room.notes ? room : {...room, notes: ""});
    jsonData.rooms = jsonData.rooms.map(room => room.code
        ? room
        : room.name && /\d\./.test(room.name)
            ? {...room, name: "", code: room.name}
            : {...room, code: ""});
    return jsonData;
}

export function downloadJson(data: string, fileName: string) {
    const blob = new Blob([data], { type: 'application/json' });
    downloadBlob(blob, fileName);
}

export function downloadObj(content: string, fileName: string) {
    const blob = new Blob([content], { type: "text/plain" });
    downloadBlob(blob, fileName);
}

export async function downloadZippedData(files: DataFile[], fileName: string) {
    const blob = await zipData(files);
    downloadBlob(blob, fileName);
}

/*export function downloadObjAsGltf(content: string, fileName: string) {
    convertObjToGlb(content).then((glbBlob) => {
        downloadBlob(glbBlob, fileName);
    });
}*/

export function downloadBlob(blob: Blob, fileName: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    link.click();

    // Cleanup
    URL.revokeObjectURL(url);
}

export function mostFrequentArrayElement<T>(arr: T[]): T {
    const frequency = new Map();
    for (const item of arr) {
        frequency.set(item, (frequency.has(item) ? frequency.get(item) : 0) + 1);
    }

    let maxItem = null;
    let maxCount = 0;
    for (const [item, count] of frequency.entries()) {
        if (count > maxCount) {
            maxCount = count;
            maxItem = item;
        }
    }

    return maxItem;
}

export function calculateScale(coordsReferences: CoordsReference[]): number {
    // we calculate the scale among all points and average it out
    if(coordsReferences.length < 2) {
        return 1;
    }

    let scaleValue = 0;
    let iterations = 0;
    for (let i = 0; i < coordsReferences.length; i++) {
        for (let j = i+1; j < coordsReferences.length; j++) {
            // calculate map meters
            const mapMeters = getVectorDistance(coordsReferences[i].mapPoint, coordsReferences[j].mapPoint);
            if (mapMeters == 0) {
                continue;
            }

            // now we calculate GPS meters
            const gpsMeters = getGpsDistance(coordsReferences[i].gpsPoint, coordsReferences[j].gpsPoint);

            // and we retrieve the scale!
            scaleValue += (gpsMeters/mapMeters);
            iterations++;
        }
    }
    return scaleValue / iterations;
}

export function findEnclosingPath(paths: Shape[], x: number, y: number): Shape | null {
    let intersectedPaths: Shape[] = []
    const clickedPoint: Vector2D = {x: x, y: y}
    for (let i = 0; i < 4; i++) {
        const xOffset = i == 2 ? 1 : i == 3 ? -1 : 0;
        const yOffset = i == 0 ? 1 : i == 1 ? -1 : 0;
        const foundPaths = findEnclosingPathWithDirection(paths, x, y, xOffset, yOffset);

        // remove the ones from intersectedPaths that don't appear here
        intersectedPaths = intersectedPaths.filter(path => foundPaths.indexOf(path) != -1);
        // and add the matching ones to the intersectedPath list
        intersectedPaths = [...intersectedPaths, ...foundPaths];

        if (foundPaths.length == 1 && polyCheck(clickedPoint, retrievePointsFromShape(foundPaths[0]))) {
            // there was only 1 path in this direction, and we're inside of it, so it should be the target - return!
            console.log("Found path in " + i + " direction iterations.");
            return foundPaths[0];
        }
    }

    // if we get here, then there was never a time where only 1 path was found. we filter the list and return the one with the most instances
    console.log("Iterated all 4 directions, choosing most frequent element");
    intersectedPaths = intersectedPaths.filter(path => polyCheck(clickedPoint, retrievePointsFromShape(path)));
    return mostFrequentArrayElement(intersectedPaths);
}

function findEnclosingPathWithDirection(paths: Shape[], x: number, y: number, xOffset: number, yOffset: number, distanceLimit: number = 300, distanceStep: number = 2): Shape[] {
    const foundPaths = []
    // TODO add option to define how far we want to search for paths
    for (let i = 0; i < distanceLimit; i += distanceStep) {
        const line = ShapeInfo.line([x, y], [x + xOffset*i, y + yOffset*i])

        for (let i = 0; i < paths.length; i++) {
            // We iterate each path and find if it intersects with the line
            const result = findIntersectionPointWithShape(paths[i], line);
            if (result.status == "Intersection") {
                foundPaths.push(paths[i]);
            }
        }

        if(foundPaths.length > 0) {
            return foundPaths;
        }
    }
    return foundPaths;
}

export function findIntersectionPointWithLine(path: Shape, lineStartX: number, lineStartY: number, lineEndX: number, lineEndY: number): Intersection {
    return findIntersectionPointWithShape(path, ShapeInfo.line([lineStartX, lineStartY], [lineEndX, lineEndY]));
}

function findIntersectionPointWithShape(shape1: Shape, shape2: unknown): Intersection {
    return Intersection.intersect(SvgShapes.element(shape1.node), shape2);
}

export function findAllPathIntersections(roomData: RoomData[], paths: Path[]): RoomIntersection[] {
    const intersections: RoomIntersection[] = [];

    for (let i = 0; i < roomData.length; i++) {
        const room1 = roomData[i];
        // todo allow definition of custom scale factor
        const polygon = createExtendedPolygon(room1, 1.01);

        for (let j = i+1; j < roomData.length; j++) {
            const room2 = roomData[j];
            const path = paths.find(path => path.id() == room2.pathId);
            if(!path) {
                console.log("Couldn't find path from roomData id!")
                continue;
            }

            const intersection: Intersection = findIntersectionPointWithShape(path, polygon);
            if (intersection.status == "Intersection") {
                // we need to calculate the average per 2 points (we assume it's annex doors)
                for (let i = 0; i < intersection.points.length; i += 2) {
                    const middle: Vector2D = intersection.points[i]
                    if (intersection.points.length > i+1) {
                        middle.x = (middle.x + intersection.points[i+1].x) / 2;
                        middle.y = (middle.y + intersection.points[i+1].y) / 2;
                    }
                    intersections.push(generateIntersection(room1.id, room2.id, middle));
                }
            }
        }
    }

    return intersections;
}

export function generateIntersection(roomId1: string, roomId2: string, intersection: Vector2D): RoomIntersection {
    // we use a custom intersection so we don't need to bother about generating the ID everywhere else
    // ~~for now the ID is the floored x and y. we'll see if that stays~~
    // (nevermind this caused issues with points that were too close, let's just randomly generate one
    return {
        id: uuidv4(),
        intersection: intersection,
        roomId1: roomId1,
        roomId2: roomId2
    }
}

export function generateFloorIntersection(originRoomId: string, isElevator: boolean, intersection: Vector2D): FloorIntersection {
    return {
        id: uuidv4(),
        intersection: intersection,
        originRoomId: originRoomId,
        isElevator: isElevator,
        targets: []
    } as FloorIntersection;
}

function createExtendedPolygon(room: RoomData, scaleFactor: number) {
    // we create a new polygon with the coords extruded ever so slightly, so we can try to find intersections more easily

    // first we discover the center of the coordinates
    const center: Vector2D = { x: room.points[0].x, y: room.points[0].y };
    for(let i = 1; i < room.points.length; i++) {
        center.x += room.points[i].x;
        center.y += room.points[i].y;
    }
    center.x /= room.points.length;
    center.y /= room.points.length;

    // now we have to scale the distance to each vector and save it as the new coords
    const coords: Vector2D[] = room.points.map(vector => {
        return {
            x: center.x + ((vector.x - center.x) * scaleFactor),
            y: center.y + ((vector.y - center.y) * scaleFactor)
        }
    });

    // and we create the polygon with the new coords
    return ShapeInfo.polygon(coords);
}

function applyMatrixToPoint(x: number, y: number, matrix: Matrix): [number, number] {
    return [
        matrix.a * x + matrix.c * y + matrix.e,
        matrix.b * x + matrix.d * y + matrix.f
    ];
}

function applyTransformationToPath(path: Path): void {
    // Get the transformation matrix
    const matrix = path.matrixify();

    // Get the path's array data
    const pathArray = path.array();

    const transformedPath = pathArray.map(segment => {
        const command = segment[0];
        const isRelative = command.toLowerCase() === command;

        for (let index = 1; index < segment.length; index++) {
            if (index % 2 !== 0 && index + 1 < segment.length) {
                let [x, y] = [Number(segment[index]), Number(segment[index + 1])];

                // If the command is relative, add the path's current position
                if (isRelative) {
                    const { x: px, y: py } = path.pointAt(0);
                    x += px;
                    y += py;
                }

                // Apply the transformation matrix
                const [newX, newY] = applyMatrixToPoint(x, y, matrix);

                // Adjust back to relative if necessary
                if (isRelative) {
                    const { x: px, y: py } = path.pointAt(0);
                    return [newX - px, newY - py];
                }

                return [newX, newY];
            }
        }

        return
    });

    // Update the path with transformed data
    path.plot(transformedPath as PathArrayAlias);
    path.untransform(); // Remove the transformation since it's applied directly
}

export function isMousePrimaryClick(e: PointerEvent) {
    if (e.pointerType == "mouse") {
        return e.button == 0;
    }
    return e.isPrimary;
}

export function getVectorDistance(a: Vector2D, b: Vector2D): number {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return Math.sqrt(dx*dx + dy*dy);
}

export function areVectorsEqual(a: Vector2D, b: Vector2D): boolean {
    return a.x == b.x && a.y == b.y;
}

export function drawRulers(canvasRef: Svg, mapRef: Svg, rulerTop: G, rulerLeft: G) {
    if(!rulerTop || !rulerLeft) {
        return;
    }

    const spacing = getTickSpacing(1);
    const fontSize = 10;
    const tickLength = 10;

    rulerTop.clear();
    rulerLeft.clear();
    const rect = canvasRef.node.getBoundingClientRect();

    // Horizontal ruler
    const xPointStep = Math.floor((rect.right - rect.left) / spacing);
    const yPointStep = Math.floor((rect.bottom - rect.top) / spacing);

    // we want the steps to be uniform, even if it means drawing less ticks on one side
    const drawnStep = Math.max(xPointStep, yPointStep);
    for (let i = 1; i <= spacing; i++) {
        const currentDrawnStep = drawnStep*i;
        const xDrawnPoint = canvasRef.point(rect.left + currentDrawnStep, rect.top);
        const xNumberPoint = mapRef.point(rect.left + currentDrawnStep, rect.top);
        rulerTop.line(xDrawnPoint.x, 0, xDrawnPoint.x, tickLength).stroke({ width: 1, color: '#888' });
        rulerTop.text(`${Math.round(xNumberPoint.x)}`)
            .move(xDrawnPoint.x + 2, tickLength + 2)
            .font({ size: fontSize, family: 'monospace' });

        const yDrawnPoint = canvasRef.point(rect.left, rect.top + currentDrawnStep);
        const yNumberPoint = mapRef.point(rect.left, rect.top + currentDrawnStep);
        rulerLeft.line(0, yDrawnPoint.y, tickLength, yDrawnPoint.y).stroke({ width: 1, color: '#888' });
        rulerLeft.text(`${Math.round(yNumberPoint.y)}`)
            .move(tickLength + 2, yDrawnPoint.y - fontSize / 2)
            .font({ size: fontSize, family: 'monospace' });
    }
}

function getTickSpacing(zoom: number) {
    if (zoom > 5) return 10;
    if (zoom > 2) return 25;
    if (zoom > 1) return 50;
    return 30;
}

// we want to avoid calling some functions way too often (like when we're panning), so we can define a measure with this
export function throttle(fn: () => void, limitMs: number): () => void {
    let lastCall = 0;
    return function () {
        const now = Date.now();
        if (now - lastCall >= limitMs) {
            lastCall = now;
            fn();
        }
    };
}

export function zipData(files: DataFile[]): Promise<Blob> {
    const zip = new JSZip();

    // Add files to the zip
    for (const file of files) {
        zip.file(file.name, file.data);
    }

    // Generate zip file as a blob
    return zip.generateAsync({ type: 'blob' });
}

export async function unzipAndLoadData(content: ArrayBuffer): Promise<LoadedData> {
    // read data
    const zip = new JSZip();
    const loadedZip = await zip.loadAsync(content);

    // we're gonna try to load the svg and json data
    let svgData: DataFile | null = null;
    let jsonData: DataFile | null = null;
    let settings: DataFile | null = null;

    async function loadDataFile(fileName: string): Promise<DataFile> {
        const data = await loadedZip.files[fileName].async("text");
        return { name: fileName, data: data }
    }

    // iterate through files
    for (const fileName of Object.keys(loadedZip.files)) {
        const names = fileName.split('.');
        const extension = names.pop();
        switch (extension) {
            case "svg": {
                console.log("Found SVG file!");
                svgData = await loadDataFile(fileName);
                break;
            }
            case "json": {
                const name = names.pop();
                console.log("Found JSON file!");
                if(name == "map") {
                    jsonData = await loadDataFile(fileName);
                } else if(name == "settings") {
                    settings = await loadDataFile(fileName);
                }
                break;
            }
        }
    }

    // transform to proper loaded data and return
    return {
        svgMap: svgData,
        jsonData: jsonData,
        settings: settings,
    }
}

/*export async function convertObjToGlb(objContent: string): Promise<Blob> {
    return new Promise((resolve, reject) => {
        try {
            // Load the OBJ content
            const loader = new OBJLoader();
            const object = loader.parse(objContent);

            const exporter = new GLTFExporter();
            exporter.parse(
                object,
                (gltf) => {
                    let blob: Blob;

                    // Check if the result is an ArrayBuffer (binary) or JSON object (text)
                    if (gltf instanceof ArrayBuffer) {
                        blob = new Blob([gltf], { type: "model/gltf-binary" });
                    } else {
                        const gltfString = JSON.stringify(gltf);
                        blob = new Blob([gltfString], { type: "application/json" });
                    }

                    resolve(blob);
                },
                () => {
                    console.log("Error transforming .obj to .gltf!")
                },
                // Correct export options
                { binary: true }
            );
        } catch (error) {
            reject(error);
        }
    });
}*/
