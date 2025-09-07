import React, {useEffect, useRef} from 'react';
import {G, Path, Rect, Shape, Svg, SVG} from '@svgdotjs/svg.js';
import './MapContainer.css';
import {useFilePicker} from 'use-file-picker';
import '@svgdotjs/svg.panzoom.js'
// @ts-ignore (No TypeScript types for the library unfortunately)
import {
    areVectorsEqual, calculateScale,
    downloadObj,
    downloadZippedData, drawRulers,
    findAllPathIntersections,
    findEnclosingPath,
    findIntersectionPointWithLine,
    generateFloorIntersection,
    generateIntersection,
    getVectorDistance,
    isMousePrimaryClick,
    loadMapData,
    mapDataToJson,
    retrievePointsFromShape,
    settingsToJson, throttle,
    unzipAndLoadData,
    Vector2D
} from "./utils.ts"
import {generateObj} from "./meshGenerator.ts";
import {getGpsDistance} from "./geodistance.ts";
import {
    MapMode,
    MapData,
    RoomData,
    RoomIntersection,
    FloorIntersection,
    CoordsReference,
    ClickData,
    LoadedData,
    DataFile,
    SelectedData,
    SelectedDataType,
    EditorSettings,
    FloorLinkingContext,
    SelectedFloorLinkingIntersection,
    AppMode, FloorIntersectionTarget,
} from './dto';
import { v4 as uuidv4 } from "uuid";

export type MapContainerProps = {
    appMode: AppMode;
    setAppMode: React.Dispatch<React.SetStateAction<AppMode>>;
};

function MapContainer({ appMode, setAppMode }: MapContainerProps) {
    console.log("Printing map container!!");
    const outerContainerRef = useRef<HTMLDivElement>(null);
    const mapCanvasRef = useRef<Svg>(null);
    const mapSvgRef = useRef<Svg>(null);
    const uiCanvasRef = useRef<Svg>(null);

    const highlightedShapes = useRef<Shape[]>([]);
    const drawnIntersections = useRef<Shape[]>([]);
    const drawnFloorIntersections = useRef<Shape[]>([]);
    const drawnRooms = useRef<Shape[]>([]);
    const drawnRoomVertex = useRef<Shape[]>([]);
    const drawnCoordsRef = useRef<Shape[]>([]);
    const drawnMapPaths = useRef<Path[]>([]);
    const modeListenersRef = useRef<(() => void)[]>([]);
    const verticalRuler = useRef<G>(null);
    const horizontalRuler = useRef<G>(null);

    const intersectionStart = useRef<{
        clickData: ClickData,
        room: RoomData
    }>(null);

    // Editor settings
    const [settings, setSettings] = React.useState<EditorSettings>({
        raycastLimit: 300,
        raycastStep: 2
    });

    const [mapMode, setMapMode] = React.useState<MapMode>(MapMode.room);
    const [loadedData, setLoadedData] = React.useState<LoadedData>();
    const [mapData, setMapData] = React.useState<MapData | null>(null);
    const [selectedData, setSelectedData] = React.useState<SelectedData[]>([]);

    // when floor linking, we're gonna save and load map data alternatively in order to visualize them properly and allow direct click of intersections
    const [floorLinkingContext, setFloorLinkingContext] = React.useState<FloorLinkingContext>();
    const [isNewFloorIntersectionElevator, setIsNewFloorIntersectionElevator] = React.useState<boolean>(false);

    // Context, currently selected data
    const currentRoom = findSelected(SelectedDataType.room, mapData?.rooms);
    const currentIntersection = findSelected(SelectedDataType.intersection, mapData?.intersections);
    const currentFloorIntersection = findSelected(SelectedDataType.floor_intersection, mapData?.floorIntersections);

    const foundVertex = selectedData.find(val => val.type == SelectedDataType.vertex);
    const foundVertexIndex = foundVertex ? Number(foundVertex.id.split("_").pop()) : NaN;
    const currentVertex = !isNaN(foundVertexIndex) && currentRoom && currentRoom.points.length >= foundVertexIndex ? currentRoom.points[foundVertexIndex] : null;

    // for the coords reference, we try to find if it exists already. if not, but we have a vertex selected, then we create it
    const currentCoordsReference = currentVertex && mapData
        ? mapData.coordsReferences.find(coords => areVectorsEqual(coords.mapPoint, currentVertex)) ?? { mapPoint: currentVertex, gpsPoint: {x: 0, y: 0} }
        : null;

    // load map selection and zip selector
    const { openFilePicker: openSvgFilePicker, filesContent: svgFilesContent } = useFilePicker({
        accept: ".svg",
    });
    const { openFilePicker: openZipFilePicker, filesContent: zipFilesContent } = useFilePicker({
        accept: ".zip",
        readAs: "ArrayBuffer"
    });
    const { openFilePicker: openFloorLinkingFilePicker, filesContent: floorLinkingFilesContent } = useFilePicker({
        accept: ".zip",
        readAs: "ArrayBuffer"
    });

    // load data and clear existing one
    if (zipFilesContent.length > 0) {
        const foundZipData = zipFilesContent[0].content;
        zipFilesContent.length = 0;
        unzipAndLoadData(foundZipData).then((result) => {
            setLoadedData(result);
        });
    } else if (svgFilesContent.length > 0) {
        // TODO have a proper way to define whether we reuse the JSON data or we use a new one!! keep in mind this will reuse the JSON while not keeping current changes!
        // we should probably separate into 2 buttons: one for a new map (no data), one to replace the map and keep everything else (keep all previous data)
        // TODO also we need to make a room cleanup if we're reusing JSON data! remove paths that don't exist anymore and regenerate all room points?
        const reuseJson = true;
        const newData = {
            svgMap: { name: svgFilesContent[0].name.replace(".svg", ""), data: svgFilesContent[0].content },
            jsonData: reuseJson && loadedData && loadedData.jsonData ? loadedData.jsonData : null,
            settings: reuseJson && loadedData && loadedData.settings ? loadedData.settings : null,
        };
        svgFilesContent.length = 0;
        setLoadedData(newData);
    } else if (floorLinkingFilesContent.length > 0) {
        const foundZipData = floorLinkingFilesContent[0].content;
        floorLinkingFilesContent.length = 0;
        unzipAndLoadData(foundZipData).then((otherLoadedData) => {

            // we also retrieve our own data
            const myLoadedData = regenerateLoadedMapData();

            // now we have both our current loaded data and the other loaded data. we save and alternate them
            setFloorLinkingContext({
                primaryData: myLoadedData,
                primaryMapId: myLoadedData?.jsonData ? loadMapData(myLoadedData.jsonData).id : "",
                secondaryData: otherLoadedData,
                secondaryMapId: otherLoadedData?.jsonData ? loadMapData(otherLoadedData.jsonData).id : "",
                step: 0
            });
            setMapMode(MapMode.floor_linking);
        });
    }

    // first load
    useEffect(() => {
        // prevent right click on the SVG area (it's used to pan)
        if (outerContainerRef.current != null) {
            outerContainerRef.current.addEventListener("contextmenu", event => event.preventDefault());
        }

        // resize svg based on window size
        window.addEventListener('resize', updateSvgSize);

        // cleanup
        return () => {
            window.removeEventListener('resize', updateSvgSize);
        }
    }, []);

    // mode changes
    useEffect(() => {
        // add mode change keyboard events
        window.addEventListener('keydown', handleKeyDown);

        // cleanup
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        }
    }, [selectedData])

    // after map is selected
    useEffect(() => {
        if (!loadedData || !loadedData.svgMap || !outerContainerRef.current) {
            return;
        }
        outerContainerRef.current.innerHTML = '';

        // Draw SVG
        const draw = SVG().addTo(outerContainerRef.current)
            .id("svgForeground")
            .svg(loadedData.svgMap.data)
            .panZoom({ zoomMin: 0.75, zoomMax: 20, panButton: 2, zoomFactor: 0.5 })
        mapCanvasRef.current = draw;
        mapSvgRef.current = draw.findOne("svg")! as Svg;

        // Add zoom events
        draw.on("zoom panEnd", redrawUI);
        const throttledRedraw = throttle(redrawUI, 200);
        draw.on("panning", throttledRedraw);

        // Draw UI
        uiCanvasRef.current = SVG().addTo(outerContainerRef.current).id("svgBackground");
        horizontalRuler.current = uiCanvasRef.current.group();
        verticalRuler.current = uiCanvasRef.current.group();

        // we load the paths from the map
        if (mapSvgRef.current != null) {
            updateSvgSize();
            let paths = mapSvgRef.current.find("path").map((element) => element as Path);
            // filter clip paths - they're not real paths that we want to render, they're masks! gave me quite the headache
            paths = paths.filter(path => !path.node.closest("clipPath"));
            drawnMapPaths.current = Array.from(paths);
        }

        // trigger map reload, whether from our data or the default one
        if (loadedData.jsonData) {
            console.log("Loading found JSON data!");
            const jsonData = loadMapData(loadedData.jsonData);

            // and if we're linking floors, and if we're in step 2, then load new intersection too!
            if (mapMode == MapMode.floor_linking && floorLinkingContext && floorLinkingContext.step == 2 && floorLinkingContext.secondaryFloorIntersection && floorLinkingContext.primaryFloorIntersection) {
                jsonData.floorIntersections = jsonData.floorIntersections.map(item => {
                    return item.id === floorLinkingContext.primaryFloorIntersection?.id
                        ? ({
                            ...item,
                            targets: [...item.targets, {
                                mapId: floorLinkingContext.secondaryFloorIntersection?.mapId,
                                intersectionId: floorLinkingContext.secondaryFloorIntersection?.id,
                            } as FloorIntersectionTarget],
                        } as FloorIntersection)
                        : item
                });
                setFloorLinkingContext({
                    primaryData: regenerateLoadedMapData(jsonData),
                    primaryMapId: floorLinkingContext.primaryMapId,
                    secondaryData: floorLinkingContext.secondaryData,
                    secondaryMapId: floorLinkingContext.secondaryMapId,
                    step: 0
                })
            }
            setMapData(jsonData);
        } else {
            const defaultMapData = {
                id: uuidv4(),
                name: loadedData.svgMap.name.replace(".svg", ""),
                rooms: [],
                intersections: [],
                coordsReferences: [],
                floorIntersections: [],
                version: 1,
                height: 6,
                altitude: 0,
                scale: 0.5
            } as MapData;
            setMapData(defaultMapData);
        }

        // load settings
        if (loadedData.settings) {
            const settingsData = JSON.parse(loadedData.settings.data);
            console.log("Loading found settings data!");
            console.log(settings);
            setSettings(settingsData);
        }
    }, [loadedData]);

    // Clear selected data if the mode changes, but not if the data changes
    useEffect(() => {
        // we clear highlighted shapes and vertex anyway
        clearHighlightedShapes();
        clearAllDrawnMetadata();

        // we keep the data if we're going into vertex mode with a room selected
        const keepData = mapMode == MapMode.room_vertex && currentRoom;
        if (!keepData) {
            clearSelectedData();
        }
    }, [mapMode]);

    // Setup new mode functions if either the mode or the data changed
    useEffect(() => {
        modeListenersRef.current.forEach((removalFunction) => removalFunction());
        modeListenersRef.current = [];
        if (!outerContainerRef.current) {
            return;
        }

        switch (mapMode) {
            case MapMode.room: {
                drawAllRooms();
                function roomListener(e: PointerEvent) {
                    if (!isMousePrimaryClick(e)) {
                        return;
                    }
                    const {shape, x, y} = generateMouseClickData(e, drawnMapPaths.current);
                    if (shape != null) {
                        selectData(shape);
                    }
                }
                addModeEvent("pointerdown", roomListener);
                break;
            }
            case MapMode.room_vertex: {
                drawAllSelectedRoomVertex();
                function roomVertexListener(e: PointerEvent) {
                    if (!isMousePrimaryClick(e)) {
                        return;
                    }
                    const {shape, x, y} = generateMouseClickData(e, drawnRoomVertex.current);
                    if (shape != null) {
                        selectData(shape);
                    }
                }
                addModeEvent("pointerdown", roomVertexListener);
                break;
            }
            case MapMode.coordinates_reference: {
                // merely a visual mode to see where our coords references are
                drawAllCoordinateReferences();
                break;
            }
            case MapMode.floor_intersection_selection: {
                drawAllFloorIntersections();
                function floorInterSelectionListener(e: PointerEvent) {
                    if (!isMousePrimaryClick(e)) {
                        return;
                    }
                    const {shape, x, y} = generateMouseClickData(e, drawnFloorIntersections.current);
                    if (shape != null) {
                        selectData(shape);
                    }
                }
                addModeEvent("pointerdown", floorInterSelectionListener);
                break;
            }
            case MapMode.floor_intersection_generation: {
                drawAllFloorIntersections();
                function floorListenerDown(e: PointerEvent) {
                    if (!isMousePrimaryClick(e) || !mapData) {
                        return;
                    }
                    const clickData = generateMouseClickData(e, drawnMapPaths.current);
                    if (clickData.shape == null) {
                        return;
                    }

                    const clickedRoom = findRoomFromPathId(clickData.shape.id());
                    const newIntersection = generateFloorIntersection(clickedRoom?.id ?? "", isNewFloorIntersectionElevator, {x: clickData.x, y: clickData.y});
                    // Save the intersection
                    setMapData({
                        ...mapData,
                        floorIntersections: [...mapData.floorIntersections, newIntersection],
                    } as MapData);
                }
                addModeEvent("pointerdown", floorListenerDown);
                break;
            }

            case MapMode.intersection_selection: {
                drawAllRoomIntersections();
                function interSelectionListener(e: PointerEvent) {
                    if (!isMousePrimaryClick(e)) {
                        return;
                    }
                    const {shape, x, y} = generateMouseClickData(e, drawnIntersections.current);
                    if (shape != null) {
                        selectData(shape);
                    }
                }
                addModeEvent("pointerdown", interSelectionListener);
                break;
            }

            case MapMode.intersection_generation: {
                drawAllRoomIntersections();
                function listenerDown(e: PointerEvent) {
                    if (!isMousePrimaryClick(e)) {
                        return;
                    }
                    const clickData = generateMouseClickData(e, drawnMapPaths.current);
                    if (clickData.shape == null) {
                        return;
                    }
                    // generate the room if it's not there yet, and add to intersection
                    const room = findOrCreateRoomData(clickData.shape);
                    if (room != null) {
                        intersectionStart.current = {
                            clickData: clickData,
                            room: room
                        };
                        console.log(`Set ${room.name} as intersection start room!`);
                    }
                }
                addModeEvent("pointerdown", listenerDown);

                function listenerUp(e: PointerEvent) {
                    if (!isMousePrimaryClick(e) || !mapData || intersectionStart.current?.clickData.shape == null) {
                        return;
                    }
                    const {shape, x, y} = generateMouseClickData(e, drawnMapPaths.current);
                    if (shape == null) {
                        return;
                    }
                    const room = findOrCreateRoomData(shape);
                    if (!room) {
                        console.log("No end room found!");
                        return
                    }
                    console.log(`Set ${room.name} as intersection end room!`);

                    // Retrieve original path and room
                    const {shape: startPath, x: startX, y: startY} = intersectionStart.current.clickData;
                    const startIntersection = findIntersectionPointWithLine(startPath, startX, startY, x, y);
                    const endIntersection = findIntersectionPointWithLine(shape, startX, startY, x, y);

                    if(startIntersection.points.length == 0 || endIntersection.points.length == 0) {
                        console.log("No intersection found for both rooms!")
                        return;
                    }

                    // We use the average (mean) to determine the actual middle point of the door, and use that one as intersection point
                    const meanX = (startIntersection.points[0].x + endIntersection.points[0].x) / 2;
                    const meanY = (startIntersection.points[0].y + endIntersection.points[0].y) / 2;
                    const finalIntersection: RoomIntersection = generateIntersection(intersectionStart.current.room.id, room.id, { x: meanX, y: meanY});

                    // Save the intersection
                    setMapData({
                        ...mapData,
                        intersections: [...mapData.intersections, finalIntersection],
                    })
                }
                addModeEvent("pointerup", listenerUp);
                break;
            }

            case MapMode.floor_linking: {
                drawAllFloorIntersections();
                function floorLinkingSelectionListener(e: PointerEvent) {
                    if (!isMousePrimaryClick(e) || !mapData || !floorLinkingContext) {
                        return;
                    }
                    const {shape, x, y} = generateMouseClickData(e, drawnFloorIntersections.current);
                    if (shape != null) {
                        const floorIntersection = findFloorIntersection(shape);
                        if (floorIntersection) {
                            // create link intersection
                            const floorLinkingIntersection = {
                                id: floorIntersection.id,
                                roomId: floorIntersection.originRoomId,
                                mapId: mapData.id
                            } as SelectedFloorLinkingIntersection;

                            // now we decide what to do based on the current state.
                            if (floorLinkingContext.step == 0) {
                                // if it's the step 0, then this is the first data! we assign it to the current state and move to the other map
                                switchFloorLinkingMapData(mapData, floorLinkingIntersection, null);
                            } else if (floorLinkingContext.step == 1) {
                                // if it's step 1, we have chosen the target data! we link in both data and return to the first map to link it there as well
                                if (!floorLinkingContext.primaryFloorIntersection) {
                                    return;
                                }
                                const newMapData = {
                                    ...mapData,
                                    floorIntersections: mapData.floorIntersections.map(item =>
                                        item.id === floorIntersection.id ? {
                                            ...item,
                                            targets: [...item.targets, {
                                                mapId: floorLinkingContext.primaryFloorIntersection?.mapId ?? undefined,
                                                intersectionId: floorLinkingContext.primaryFloorIntersection?.id ?? undefined,
                                            } as FloorIntersectionTarget]
                                        } as FloorIntersection : item
                                    )
                                }
                                switchFloorLinkingMapData(newMapData, null, floorLinkingIntersection);
                            }
                        }
                    }
                }
                addModeEvent("pointerdown", floorLinkingSelectionListener);
                break;
            }
        }
    }, [mapMode, mapData, floorLinkingContext, isNewFloorIntersectionElevator]);

    // executes every time the floorLinkingContext changes (to update the maps)
    useEffect(() => {
        if (!floorLinkingContext || floorLinkingContext.step == 0) {
            return;
        }
        // we update the data!
        setLoadedData(floorLinkingContext.step == 1 ? floorLinkingContext.secondaryData : floorLinkingContext.primaryData);
    }, [floorLinkingContext]);

    // executes every time the mapData changes (for example to redraw intersections)
    useEffect(() => {
        if(!mapData) {
            return;
        }
        drawAllIntersectionsIfEnabled();
    }, [mapData]);

    // executes every time the settings change (to update visual stuff)
    useEffect(() => {
        // redraw intersections as they use the scale
        drawAllIntersectionsIfEnabled();
    }, [settings]);

    function switchFloorLinkingMapData(overrideMapData: MapData, newPrimaryIntersection: SelectedFloorLinkingIntersection | null,
                                       newSecondaryIntersection: SelectedFloorLinkingIntersection | null) {
        if (!floorLinkingContext) {
            return;
        }
        const currentData = regenerateLoadedMapData(overrideMapData);
        if (floorLinkingContext.step % 2 == 0) {
            setFloorLinkingContext({
                ...floorLinkingContext,
                primaryData: currentData,
                primaryFloorIntersection: newPrimaryIntersection ?? floorLinkingContext.primaryFloorIntersection,
                secondaryFloorIntersection: newSecondaryIntersection ?? floorLinkingContext.secondaryFloorIntersection,
                step: floorLinkingContext.step + 1,
            });
        } else {
            setFloorLinkingContext({
                ...floorLinkingContext,
                secondaryData: currentData,
                primaryFloorIntersection: newPrimaryIntersection ?? floorLinkingContext.primaryFloorIntersection,
                secondaryFloorIntersection: newSecondaryIntersection ?? floorLinkingContext.secondaryFloorIntersection,
                step: floorLinkingContext.step + 1,
            });
        }
    }

    function findSelected<T extends {id: string}>(type: SelectedDataType, mapList: T[] | undefined): T | null {
        const found = selectedData.find(val => val.type === type);
        return found ? mapList?.find(item => item.id === found.id) ?? null : null;
    }

    function addModeEvent(type: string, listener: ((e: Event) => void) | ((e: PointerEvent) => void)) {
        if(!outerContainerRef.current) {
            return;
        }
        outerContainerRef.current.addEventListener(type, listener as EventListener);
        modeListenersRef.current.push(() => outerContainerRef.current?.removeEventListener(type, listener as EventListener));
    }

    function generateMouseClickData(e: Event, svgShapes: Shape[]): ClickData {
        if(!mapSvgRef.current || !svgShapes) {
            return { shape: null, x: 0, y: 0 }
        }
        const mouseEvent = e as MouseEvent;
        const { x, y } = mapSvgRef.current.point(mouseEvent.clientX, mouseEvent.clientY);
        const path = findEnclosingPath(svgShapes, x, y);
        return {shape: path, x: x, y: y};
    }

    function drawSquare(x: number, y: number, size: number, color: string = "red") {
        if(!mapSvgRef.current) {
            return;
        }
        const scaledSize = 0.75 / size;
        return mapSvgRef.current.rect(scaledSize, scaledSize)
            .move(x - scaledSize / 2, y - scaledSize / 2)  // Center the square at (x, y)
            .fill({color: color, opacity: 0.6})
            .stroke({ color: 'black', width: scaledSize / 10 });  // Optional border
    }

    // !!! drawing circles messes up with our point coords detection system. so let's stay with squares for now
    function drawCircle(x: number, y: number, size: number) {
        if(!mapSvgRef.current) {
            return;
        }
        const color = "orange";
        return mapSvgRef.current.circle(size)
            .move(x - size / 2, y - size / 2)  // Center the square at (x, y)
            .fill({color: color, opacity: 0.6})
            .stroke({ color: 'black', width: size / 10 });  // Optional border
    }

    function updateSvgSize() {
        if(!mapSvgRef.current || !mapCanvasRef.current) {
            return;
        }

        // Get the container's current size
        const containerWidth = outerContainerRef.current!.offsetWidth;
        const containerHeight = outerContainerRef.current!.offsetHeight;

        // Set the SVG size to match the container's size
        mapSvgRef.current.size(containerWidth, containerHeight);

        // Adjust the viewbox to ensure the map is correctly scaled within the new size
        const width = Number(mapSvgRef.current.width());
        const height = Number(mapSvgRef.current.height());
        mapCanvasRef.current.size(width, height).viewbox(0, 0, width, height);

        // Draw UI
        redrawUI();
    }

    function redrawUI() {
        if(!uiCanvasRef.current || !mapSvgRef.current || !horizontalRuler.current || !verticalRuler.current) {
            return;
        }

        // Rulers
        drawRulers(uiCanvasRef.current, mapSvgRef.current, horizontalRuler.current, verticalRuler.current);
    }

    function handleKeyDown(e: KeyboardEvent) {
        // we skip if they're writing in the input (like name)
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
            return;
        }
        // skip ctrl stuff (we don't wanna mess with control commands for now)
        if (e.ctrlKey || e.metaKey) {
            return;
        }
        // also skip if we're floor linking, unless we're trying to escape from linking 2 elements
        if (mapMode == MapMode.floor_linking) {
            switch (e.key) {
                case "Delete": {
                    deleteCurrentSelected();
                    break;
                }
            }
            return;
        }

        switch (e.key) {
            // otherwise we allow mode changes
            case "i":
                setMapMode(MapMode.intersection_selection);
                break;
            case "g":
                setMapMode(MapMode.intersection_generation);
                break;
            case "r":
                setMapMode(MapMode.room);
                break;
            case "v":
                setMapMode(MapMode.room_vertex);
                break;
            case "c":
                setMapMode(MapMode.coordinates_reference);
                break;
            case "f":
                setMapMode(MapMode.floor_intersection_selection);
                break;
            case "n":
                setMapMode(MapMode.floor_intersection_generation);
                break;
            case "e": {
                setIsNewFloorIntersectionElevator(prev => !prev);
                break;
            }

            // or we delete selected data
            case "Delete":
                deleteCurrentSelected();
                break;
        }
    }

    function deleteCurrentSelected() {
        if (!selectedData) {
            return;
        }
        if (mapMode == MapMode.intersection_selection) {
            deleteIntersection();
        } else if (mapMode == MapMode.floor_intersection_selection) {
            deleteFloorIntersection();
        } else if (mapMode == MapMode.room) {
            deleteRoom();
        } else if (mapMode == MapMode.room_vertex && currentCoordsReference) {
            setNewLatitudeLongitude(0, 0);
        }
    }

    function findOrCreateRoomData(originalPath: Shape) : RoomData | null {
        if (!mapData) {
            return null;
        }
        // Try to find room
        const pathId = originalPath.id()
        const room = mapData.rooms.find(room => room.pathId === pathId);
        if(room) {
            // It was already created, return
            return room;
        }

        // Otherwise we have to create it
        const newRoom = {id: uuidv4(), pathId: pathId, name: "", code: "", notes: "", points: retrievePointsFromShape(originalPath)};
        setMapData(previous => previous == null ? null : {
            ...previous,
            rooms: [...previous.rooms, newRoom]
        });

        return newRoom;
    }

    function findIntersection(clickedIntersection: Shape) {
        if (!mapData) {
            return null;
        }
        const id = clickedIntersection.id();
        return mapData.intersections.find(intersection => intersection.id === id);
    }

    function findFloorIntersection(clickedIntersection: Shape) {
        if (!mapData) {
            return null;
        }
        const id = clickedIntersection.id();
        return mapData.floorIntersections.find(intersection => intersection.id === id);
    }

    function findRoomVertex(clickedIntersection: Shape) {
        if (!mapData || !currentRoom) {
            return null;
        }
        const id = clickedIntersection.id().split("_").pop();
        return currentRoom.points[Number(id)];
    }

    function clearSelectedData() {
        clearHighlightedShapes();
        setSelectedData([]);
    }

    function clearHighlightedShapes() {
        for (const shape of highlightedShapes.current) {
            shape.remove();
        }
        highlightedShapes.current = [];
    }

    function selectData(originalShape: Shape) {
        // Clear selected data and highlight new one
        clearHighlightedShapes();
        const path = highlightShape(originalShape);
        highlightedShapes.current.push(path);

        // Assign new selected data
        const newData = findNewSelectedData(originalShape);
        if(newData) {
            setSelectedData(newData);
        }
    }

    function findNewSelectedData(originalShape: Shape) : SelectedData[] | null {
        if (mapMode == MapMode.room && originalShape instanceof Path) {
            // Clicked a room! We retrieve or create new room data
            const room = findOrCreateRoomData(originalShape);
            if(room) {
                return [{
                    type: SelectedDataType.room,
                    id: room.id
                }];
            }
        } else if (mapMode == MapMode.intersection_selection && originalShape instanceof Rect) {
            // clicked an intersection!
            const intersection = findIntersection(originalShape);
            if(intersection) {
                return [{
                    type: SelectedDataType.intersection,
                    id: intersection.id
                }];
            }
        } else if (mapMode == MapMode.floor_intersection_selection && originalShape instanceof Rect) {
            // clicked an intersection!
            const intersection = findFloorIntersection(originalShape);
            if(intersection) {
                return [{
                    type: SelectedDataType.floor_intersection,
                    id: intersection.id
                }];
            }
        } else if (mapMode == MapMode.room_vertex && originalShape instanceof Rect) {
            // clicked room vertex! we keep the selected room but change the vertex
            const vertex = findRoomVertex(originalShape);
            if(vertex) {
                return [
                    ...selectedData.filter(data => data.type !== SelectedDataType.vertex),
                    {
                        type: SelectedDataType.vertex,
                        id: originalShape.id()
                    }
                ];
            }
        }
        return null;
    }

    function highlightShape(originalShape: Shape, fillColor: string = 'limegreen', strokeColor: string = 'blue') {
        const path = originalShape.clone()
        path.attr('style', null);
        path.fill({ color: fillColor, opacity: 0.6 });
        path.stroke({ color: strokeColor, width: (mapData?.scale ?? 1) / 5 });
        if(mapSvgRef.current) {
            mapSvgRef.current.add(path);
        }
        return path;
    }

    function updateRoomData(roomData: RoomData) {
        if(!mapData) {
            return;
        }
        // update room data within the map data
        setMapData({
            ...mapData,
            rooms: mapData.rooms.map((room) =>
                room.id === roomData.id ? roomData : room
            ),
        });
    }

    function handleNameChange(e: React.ChangeEvent<HTMLInputElement>) {
        if(!currentRoom) {
            return;
        }
        updateRoomData({
            ...currentRoom,
            name: e.target.value,
        })
    }

    function handleCodeChange(e: React.ChangeEvent<HTMLInputElement>) {
        if(!currentRoom) {
            return;
        }
        updateRoomData({
            ...currentRoom,
            code: e.target.value,
        })
    }

    function handleNotesChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
        if(!currentRoom) {
            return;
        }
        updateRoomData({
            ...currentRoom,
            notes: e.target.value,
        })
    }

    function handleScaleChange(e: React.ChangeEvent<HTMLInputElement>) {
        updateMapDataNumber(e, "scale");
    }

    function handleVersionChange(e: React.ChangeEvent<HTMLInputElement>) {
        updateMapDataNumber(e, "version");
    }

    function handleHeightChange(e: React.ChangeEvent<HTMLInputElement>) {
        updateMapDataNumber(e, "height");
    }

    function handleAltitudeChange(e: React.ChangeEvent<HTMLInputElement>) {
        updateMapDataNumber(e, "altitude");
    }

    function updateMapDataNumber<K extends keyof MapData>(e: React.ChangeEvent<HTMLInputElement>, param: K) {
        const value = Number(e.target.value);
        if (!isNaN(value) && mapData) {
            setMapData({
                ...mapData,
                [param]: value,
            });
        }
    }

    function handleLatitudeChange(e: React.ChangeEvent<HTMLInputElement>) {
        const value = Number(e.target.value);
        if (!isNaN(value) && currentCoordsReference) {
            setNewLatitudeLongitude(value, currentCoordsReference.gpsPoint.y)
        }
    }

    function handleLongitudeChange(e: React.ChangeEvent<HTMLInputElement>) {
        const value = Number(e.target.value);
        if (!isNaN(value) && currentCoordsReference) {
            setNewLatitudeLongitude(currentCoordsReference.gpsPoint.x, value)
        }
    }

    function setNewLatitudeLongitude(latitude: number, longitude: number) {
        if(!currentCoordsReference || !currentVertex || !mapData) {
            return;
        }

        // we're gonna update the point in the list, so we have to retrieve the list without it
        const noPointData = mapData.coordsReferences.filter(coords => !(areVectorsEqual(coords.mapPoint, currentVertex)))

        if (longitude == 0 && latitude == 0) {
            // they deleted the reference, we just assign the list without it
            setMapData({
                ...mapData,
                coordsReferences: noPointData
            });
            recalculateScale(noPointData)
        } else {
            // we update the point with the new data, only if it hasn't been added already
            const newPointReferences = [...noPointData, { mapPoint: currentVertex, gpsPoint: { x: latitude, y: longitude } }];
            setMapData({
                ...mapData,
                coordsReferences: newPointReferences,
            });
            recalculateScale(newPointReferences)
        }

    }

    function recalculateScale(coordsReferences: CoordsReference[]) {
        const scale = calculateScale(coordsReferences);
        setMapData(previous => previous == null ? null : {
            ...previous,
            scale: scale
        });
    }

    function regenerateLoadedMapData(overrideMapData?: MapData) {
        const currentData = zipBasicBundle(true, loadedData, overrideMapData);
        return {
            svgMap: currentData[2],
            jsonData: currentData[0],
            settings: currentData[1],
        } as LoadedData;
    }

    async function downloadMapData() {
        if (!mapData || !loadedData || !loadedData.svgMap) {
            console.log("Can't download null map data!");
            return;
        }

        await downloadZippedData(zipDevelopmentBundle(), mapData.name + ".zip");
    }

    async function downloadMapLinkingData() {
        if (!floorLinkingContext || mapMode != MapMode.floor_linking || !floorLinkingContext.primaryData?.jsonData || !floorLinkingContext.secondaryData?.jsonData) {
            return;
        }

        // download data from primary and secondary maps
        const mapData1 = loadMapData(floorLinkingContext.primaryData.jsonData);
        await downloadZippedData(zipDevelopmentBundle(floorLinkingContext.primaryData, mapData1), mapData1.name + ".zip");
        const mapData2 = loadMapData(floorLinkingContext.secondaryData.jsonData);
        await downloadZippedData(zipDevelopmentBundle(floorLinkingContext.secondaryData, mapData2), mapData2.name + ".zip");
    }

    function zipDevelopmentBundle(overrideLoadedData?: LoadedData, overrideMapData?: MapData) {
        const finalData = overrideLoadedData ?? loadedData;
        const finalMapData = overrideMapData ?? mapData;
        if (!finalMapData || !finalData || !finalData.svgMap) {
            console.log("Can't download null map data!");
            return [];
        }

        const basicBundle = zipBasicBundle(true, finalData, overrideMapData);

        // and we're also gonna download the obj
        const obj: DataFile = {
            name: "mesh.obj",
            data: generateObj(finalMapData)
        }

        return [...basicBundle, obj];
    }

    function zipBasicBundle(includeSvg: boolean, loadedData: LoadedData | undefined, overrideMapData?: MapData): DataFile[] {
        if (!mapData || !loadedData || !loadedData.svgMap) {
            return [];
        }

        // download JSON file
        const json: DataFile = {
            name: "map.json",
            data: mapDataToJson(overrideMapData ?? mapData)
        }
        // download editor settings, or reuse the loaded data ones if we're overriding the map
        const settingFile: DataFile = {
            name: "settings.json",
            data: overrideMapData && loadedData.settings ? loadedData.settings.data : settingsToJson(settings)
        }
        // and we might also download the map
        const map: DataFile = {
            name: "vector.svg",
            data: loadedData.svgMap.data
        }

        return [json, settingFile, ...(includeSvg ? [map] : [])];
    }

    function downloadMapMesh() {
        if (mapData != null) {
            const objContent = generateObj(mapData);
            downloadObj(objContent, "extruded_shape.obj");
            //downloadObjAsGltf(objContent, "extruded_shape.gltf");
        } else {
            console.log("Can't generate mesh from null map data!");
        }
    }

    function loadAllPaths() {
        // since we already know where all the paths are in the new version... let's load them at once so they can be exported to the 3D mesh, even if they have no data
        if(!drawnMapPaths.current || !mapData) {
            return;
        }

        const currentRooms = mapData.rooms;
        for (const originalPath of drawnMapPaths.current) {
            const room = findOrCreateRoomData(originalPath);
            if(room) {
                if (!currentRooms.includes(room)) {
                    console.log("Created new room: " + room.id);
                }
            }
        }
    }

    function deleteRoom() {
        if(!currentRoom || !mapData) {
            return;
        }

        // clear selection
        const roomToRemove = currentRoom;
        clearSelectedData();

        // we need to delete it from the rooms and intersections
        setMapData({
            ...mapData,
            rooms: mapData.rooms.filter(room => room.id != roomToRemove.id),
            intersections: mapData.intersections.filter(intersection => intersection.roomId1 != roomToRemove.id && intersection.roomId2 != roomToRemove.id),
        });
    }

    function deleteIntersection() {
        if(!currentIntersection || !mapData) {
            return;
        }

        // clear selection and delete
        const intersectionToRemove = currentIntersection;
        clearSelectedData();
        setMapData({
            ...mapData,
            intersections: mapData.intersections.filter(intersection => intersection.id != intersectionToRemove.id),
        });
    }

    function deleteFloorIntersection() {
        if(!currentFloorIntersection || !mapData) {
            return;
        }

        // clear selection and delete
        const intersectionToRemove = currentFloorIntersection;
        clearSelectedData();
        setMapData({
            ...mapData,
            floorIntersections: mapData.floorIntersections.filter(intersection => intersection.id != intersectionToRemove.id),
        });
    }

    function loadAllIntersections() {
        if(!drawnMapPaths.current || !mapData) {
            return;
        }

        const intersections: RoomIntersection[] = findAllPathIntersections(mapData.rooms, drawnMapPaths.current);
        setMapData({
            ...mapData,
            intersections: intersections
        })
    }

    function clearAllDrawnMetadata() {
        clearAllDrawnRooms();
        clearAllDrawnRoomVertex();
        clearAllDrawnCoordinateReferences();
        clearAllDrawnRoomIntersections();
        clearAllDrawnFloorIntersections();
    }

    function drawAllIntersectionsIfEnabled() {
        if(mapMode == MapMode.intersection_generation || mapMode == MapMode.intersection_selection) {
            drawAllRoomIntersections();
        } else if(mapMode == MapMode.floor_intersection_selection || mapMode == MapMode.floor_intersection_generation) {
            drawAllFloorIntersections();
        }
    }

    function clearAllDrawnRoomIntersections() {
        clearDrawnArray(drawnIntersections);
    }

    function drawAllRoomIntersections() {
        if(!mapData) {
            return;
        }
        clearAllDrawnMetadata();
        for (const intersection of mapData.intersections) {
            const shape = drawSquare(intersection.intersection.x, intersection.intersection.y, mapData.scale);
            if(shape) {
                shape.id(intersection.id);
                drawnIntersections.current.push(shape);
            }
        }
    }

    function clearAllDrawnFloorIntersections() {
        clearDrawnArray(drawnFloorIntersections);
    }

    function drawAllFloorIntersections() {
        if(!mapData) {
            return;
        }
        clearAllDrawnMetadata();
        for (const intersection of mapData.floorIntersections) {
            let isLinked = false;
            if (floorLinkingContext) {
                const newId = mapData.id === floorLinkingContext.primaryMapId ? floorLinkingContext.secondaryMapId : floorLinkingContext.primaryMapId;
                isLinked = intersection.targets.find(target => target.mapId === newId) != undefined;
            }
            const color = isLinked ? "green" : (intersection.isElevator ? "orange" : "red");
            const shape = drawSquare(intersection.intersection.x, intersection.intersection.y, mapData.scale, color);
            if(shape) {
                shape.id(intersection.id);
                drawnFloorIntersections.current.push(shape);
            }
        }
    }

    function clearAllDrawnRooms() {
        clearDrawnArray(drawnRooms);
    }

    function drawAllRooms() {
        if(!drawnMapPaths.current || !mapData) {
            return;
        }
        clearAllDrawnMetadata();
        // highlight all rooms without a name in red, so we can find them easily
        for (let i = 0; i < drawnMapPaths.current.length; i++) {
            const path = drawnMapPaths.current[i];
            const room = mapData.rooms.find(room => room.pathId === path.id());
            const noName = !room || !room.name || room.name === "" || room.name.startsWith("???");
            const noCode = !room || !room.code || room.code === "";
            if(noName && noCode) {
                const shape = highlightShape(path, "red", "black");
                shape.id(mapData.id + "_room" + i);
                drawnRooms.current.push(shape);
            }
        }
    }

    function clearAllDrawnRoomVertex() {
        clearDrawnArray(drawnRoomVertex);
    }

    function drawAllSelectedRoomVertex() {
        if(!currentRoom || !mapData) {
            return;
        }
        clearAllDrawnMetadata();
        for (let i = 0; i < currentRoom.points.length; i++) {
            const intersection = currentRoom.points[i];
            const shape = drawSquare(intersection.x, intersection.y, mapData.scale);
            if(shape) {
                shape.id(currentRoom.id + "_" + i);
                drawnRoomVertex.current.push(shape);
            }
        }
    }

    function clearAllDrawnCoordinateReferences() {
        clearDrawnArray(drawnCoordsRef);
    }

    function clearDrawnArray(array: React.RefObject<Shape[]>) {
        for (const shape of array.current) {
            shape.remove();
        }
        array.current = [];
    }

    function drawAllCoordinateReferences() {
        if (!mapData) {
            return;
        }
        clearAllDrawnMetadata();
        for (let i = 0; i < mapData.coordsReferences.length; i++) {
            const point = mapData.coordsReferences[i];
            const shape = drawSquare(point.mapPoint.x, point.mapPoint.y, mapData.scale);
            if(shape) {
                shape.id(mapData.name + "_" + i);
                drawnCoordsRef.current.push(shape);
            }
        }
    }

    function clearAllData() {
        if(!mapData) {
            return;
        }
        clearSelectedData();
        clearAllDrawnMetadata();
        setMapData({
            ...mapData,
            intersections: [],
            rooms: [],
            coordsReferences: []
        } as MapData)
    }

    function findRoom(id: string) {
        return mapData?.rooms.find(room => room.id == id) ?? null;
    }

    function findRoomFromPathId(pathId: string) {
        return mapData?.rooms.find(room => room.pathId == pathId) ?? null;
    }

    function findDrawnPath(id: string) {
        for (const path of drawnMapPaths.current) {
            if (path.id() == id) {
                return path;
            }
        }
        return null;
    }

    function portPathData() {
        if(!mapData) {
            return;
        }

        // we're gonna randomize all the path IDs now that we have proper pathId data
        for (const room of mapData.rooms) {
            const oldId = room.id;
            const newId = uuidv4();
            setMapData(previous => previous == null ? null : {
                ...previous,
                rooms: previous.rooms.map(room => room.id != oldId ? room : {...room, id: newId}),
                intersections: previous.intersections.map(inter => inter.roomId1 != oldId && inter.roomId2 != oldId
                    ? inter
                    : {...inter, roomId1: inter.roomId1 == oldId ? newId : inter.roomId1, roomId2: inter.roomId2 == oldId ? newId : inter.roomId2}),
                floorIntersections: []
            });
        }
    }

    function clearOldData() {
        // we need to check if there are rooms that don't exist in the SVG anymore!
        if(!mapData) {
            return;
        }

        for (const mapRoom of mapData.rooms) {
            if (!findDrawnPath(mapRoom.pathId)) {
                console.log("Couldn't find an existing path for room " + mapRoom.id);
                setMapData(previous => previous == null ? null : {
                    ...previous,
                    rooms: previous.rooms.filter(room => room.id != mapRoom.id),
                });
            }
        }

        for (const roomIntersection of mapData.intersections) {
            const room1 = findRoom(roomIntersection.roomId1);
            const room2 = findRoom(roomIntersection.roomId1);
            if (!room1 || !room2 || !findDrawnPath(room1.pathId) || !findDrawnPath(room2.pathId)) {
                console.log("Couldn't find an existing path for room intersection " + roomIntersection.id);
                setMapData(previous => previous == null ? null : {
                    ...previous,
                    intersections: previous.intersections.filter(elem => elem.id != roomIntersection.id),
                });
            }
        }

        for (const floorIntersection of mapData.floorIntersections) {
            const room = findRoom(floorIntersection.originRoomId);
            if (!room || !findDrawnPath(room.pathId)) {
                console.log("Couldn't find an existing path for floor intersection " + floorIntersection.id);
                setMapData(previous => previous == null ? null : {
                    ...previous,
                    floorIntersections: previous.floorIntersections.filter(elem => elem.id != floorIntersection.id),
                });
            }
        }
    }

    function debugSetTopLeftD06() {
        setNewLatitudeLongitude(40.33212963978632, -3.7664528663072234);
    }

    function debugSetBottomRightD06() {
        setNewLatitudeLongitude(40.33210101450282, -3.7665286387103065);
    }

    function debugSetTopLeftC12() {
        setNewLatitudeLongitude(40.332480613933335, -3.7664959752137745);
    }

    function debugSetBottomRightC12() {
        setNewLatitudeLongitude(40.33239167151102, -3.7667098813782287);
    }

    function enterFloorLinking() {
        openFloorLinkingFilePicker();
    }

    async function finishFloorLinking() {
        await downloadMapLinkingData();
        setFloorLinkingContext(undefined);
        setMapMode(MapMode.room);
    }

    function createCampusBundle() {
        setAppMode(AppMode.bundle_creation);
    }

    return (
        <>
            <div id="headerBar">
                <h1>PlanMapper</h1>
                <button onClick={openSvgFilePicker}>Select SVG file</button>
                <button onClick={openZipFilePicker}>Select ZIP data</button>
                <button onClick={clearAllData}>Clear all data</button>
                {mapMode != MapMode.floor_linking
                    ? <button onClick={enterFloorLinking}>Enter floor linking mode</button>
                    : <button onClick={finishFloorLinking}>Leave linking mode and download bundles</button>
                }
                <button onClick={createCampusBundle}>Create campus bundle</button>
            </div>

            <div id="mapContainer">
                <div id="selectedData">
                    <span>Mode: {MapMode[mapMode]}</span>
                    {mapMode == MapMode.floor_linking && floorLinkingContext
                        ? (
                            <div>
                                <p>Current floor linking step: {floorLinkingContext.step}</p>
                                <p>Current primary intersection ID: {floorLinkingContext.primaryFloorIntersection?.id}</p>
                                <p>Current primary intersection map: {floorLinkingContext.primaryFloorIntersection?.mapId}</p>
                                <p>Current secondary intersection ID: {floorLinkingContext.secondaryFloorIntersection?.id}</p>
                                <p>Current secondary intersection map: {floorLinkingContext.secondaryFloorIntersection?.mapId}</p>
                            </div>
                        )
                        : (
                            <ul>
                                <li>[R] Room selection</li>
                                <li>[V] Room vertex</li>
                                <li>[I] Intersection selection</li>
                                <li>[G] Intersection generation</li>
                                <li>[C] Show coordinates references</li>
                                <li>[F] Floor intersection selection</li>
                                <li>[N] Floor intersection generation</li>
                            </ul>
                        )
                    }

                    {mapData &&
                        <div>
                            <button onClick={downloadMapData}>Download data</button>
                            <button onClick={downloadMapMesh}>Download 3D mesh</button>
                            <button onClick={clearOldData}>Clear old data</button>
                            <button onClick={() => recalculateScale(mapData.coordsReferences)}>Recalculate scale</button>
                            <p>Current map: {mapData.name} [R={mapData.rooms.length}  I={mapData.intersections.length}  CR={mapData.coordsReferences.length}]</p>
                            <p>Current ID: {mapData.id}</p>
                            <button onClick={loadAllPaths}>Generate all paths</button>
                            <button onClick={loadAllIntersections}>Generate all intersections</button>
                            <div>
                                <label htmlFor="version">Map version</label>
                                <input
                                    id="version"
                                    name="version"
                                    type="number"
                                    value={mapData.version}
                                    onChange={handleVersionChange}
                                />
                            </div>
                            <div>
                                <label htmlFor="scale">Map scale (meter / map unit)</label>
                                <input
                                    id="scale"
                                    name="scale"
                                    type="number"
                                    step=".01"
                                    value={mapData.scale}
                                    onChange={handleScaleChange}
                                    placeholder="Type the map's scale"
                                />
                            </div>
                            <div>
                                <label htmlFor="height">Floor height</label>
                                <input
                                    id="height"
                                    name="height"
                                    type="number"
                                    value={mapData.height}
                                    onChange={handleHeightChange}
                                />
                            </div>
                            <div>
                                <label htmlFor="altitude">Floor GPS altitude</label>
                                <input
                                    id="altitude"
                                    name="altitude"
                                    type="number"
                                    value={mapData.altitude}
                                    onChange={handleAltitudeChange}
                                />
                            </div>
                            <hr/>
                        </div>
                    }

                    {currentRoom && mapMode == MapMode.room &&
                        <div>
                            <div>
                                <label htmlFor="name">Name:</label>
                                <input
                                    id="name"
                                    name="name"
                                    value={currentRoom.name}
                                    onChange={handleNameChange}
                                    placeholder="Type the room's name"
                                />
                            </div>
                            <div>
                                <label htmlFor="code">Code:</label>
                                <input
                                    id="code"
                                    name="code"
                                    value={currentRoom.code}
                                    onChange={handleCodeChange}
                                    placeholder="Type the room's code"
                                />
                            </div>
                            <div>
                                <label htmlFor="notes">Notes:</label>
                                <textarea
                                    id="notes"
                                    name="notes"
                                    value={currentRoom.notes}
                                    onChange={handleNotesChange}
                                    placeholder="Type any notes regarding this room"
                                />
                            </div>
                            <p>Current name: {currentRoom.name}</p>
                            <p>Current code: {currentRoom.code}</p>
                            <p>Current ID: {currentRoom.id}</p>
                            <p>Current path ID: {currentRoom.pathId}</p>
                            <p>Number of points: {currentRoom.points.length}</p>
                            <button onClick={deleteRoom}>Delete room</button>

                            {/*
                            <p>List of points:</p>
                            <ul>
                                {currentRoom.points.map(point => (
                                    <li>{point.x}, {point.y}</li>
                                ))}
                            </ul>
                            */}
                        </div>
                    }
                    {currentIntersection &&
                        <div>
                            <p>Current ID: {currentIntersection.id}</p>
                            <p>Room #1 ID: {currentIntersection.roomId1}</p>
                            <p>Room #2 ID: {currentIntersection.roomId2}</p>
                            <button onClick={deleteIntersection}>Delete intersection</button>

                            <p>Intersection X: {currentIntersection.intersection.x}</p>
                            <p>Intersection Y: {currentIntersection.intersection.y}</p>
                        </div>
                    }
                    {mapMode === MapMode.floor_intersection_generation &&
                        <p>[E] Is new intersection a elevator? {isNewFloorIntersectionElevator ? "YES" : "NO"}</p>
                    }
                    {currentFloorIntersection &&
                        <div>
                            <p>Current ID: {currentFloorIntersection.id}</p>
                            <p>Origin room: {currentFloorIntersection.originRoomId}</p>
                            {currentFloorIntersection.targets.map((target) => (
                                <ul>
                                    <p>Target map: {target.mapId}</p>
                                    <p>Target intersection: {target.intersectionId}</p>
                                </ul>
                                ))
                            }
                            <button onClick={deleteFloorIntersection}>Delete floor intersection</button>

                            <p>Intersection X: {currentFloorIntersection.intersection.x}</p>
                            <p>Intersection Y: {currentFloorIntersection.intersection.y}</p>
                        </div>
                    }
                    {currentVertex && currentCoordsReference &&
                        <div>
                            <p>Vertex ID: {selectedData.find(val => val.type == SelectedDataType.vertex)?.id}</p>
                            <p>Vertex X: {currentVertex.x}</p>
                            <p>Vertex Y: {currentVertex.y}</p>
                            <div>
                                <label htmlFor="gpsX">GPS Latitude:</label>
                                <input
                                    id="gpsX"
                                    name="gpsX"
                                    value={currentCoordsReference.gpsPoint.x}
                                    onChange={handleLatitudeChange}
                                    placeholder="Vertex latitude"
                                />
                            </div>
                            <div>
                                <label htmlFor="gpsY">GPS Longitude:</label>
                                <input
                                    id="gpsY"
                                    name="gpsY"
                                    value={currentCoordsReference.gpsPoint.y}
                                    onChange={handleLongitudeChange}
                                    placeholder="Vertex longitude"
                                />
                            </div>
                            <button onClick={debugSetTopLeftD06}>DEBUG 2.1.D06 top-left</button>
                            <button onClick={debugSetBottomRightD06}>DEBUG 2.1.D06 bottom-right</button>
                            <button onClick={debugSetTopLeftC12}>DEBUG 2.0.C12 top-left</button>
                            <button onClick={debugSetBottomRightC12}>DEBUG 2.0.C12 bottom-right</button>
                        </div>
                    }
                </div>

                <div ref={outerContainerRef} id="svgContainer" />
            </div>
        </>
    );
}



export default MapContainer;
