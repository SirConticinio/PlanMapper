import {Vector2D} from "./utils.ts";
import {Shape} from "@svgdotjs/svg.js";

export type MapData = {
    id: string;
    name: string;
    rooms: RoomData[];
    intersections: RoomIntersection[];
    coordsReferences: CoordsReference[];
    floorIntersections: FloorIntersection[];
    version: number;
    height: number;
    altitude: number;
    scale: number;
}

export type RoomData = {
    id: string;
    pathId: string;
    name: string;
    code: string;
    notes: string;
    points: Vector2D[];
    // TODO fix "going back" logic between menus, change visuals?
}

export type BundleBuildingInfo = {
    id: string,
    name: string,
    floors: BundleFloorInfo[]
}

export type BundleFloorInfo = {
    id: string,
    name: string,
    number: number,
    isGroundFloor: boolean,
    version: number
}

export enum AppMode {
    map,
    bundle_creation
}

export enum MapMode {
    room,
    intersection_selection,
    intersection_generation,
    room_vertex,
    coordinates_reference,
    floor_intersection_selection,
    floor_intersection_generation,
    floor_linking,
}

export type RoomIntersection = {
    id: string,
    roomId1: string,
    roomId2: string,
    intersection: Vector2D
}

export type FloorIntersection = {
    id: string,
    intersection: Vector2D,
    isElevator: boolean,
    originRoomId: string,
    targets: FloorIntersectionTarget[];
}

export type FloorIntersectionTarget = {
    mapId: string,
    intersectionId: string,
}

export type CoordsReference = {
    mapPoint: Vector2D;
    gpsPoint: Vector2D;
}

export type ClickData = {
    shape: Shape | null,
    x: number,
    y: number
}

export type LoadedData = {
    svgMap: DataFile | null,
    jsonData: DataFile | null,
    settings: DataFile | null,
}

export type DataFile = {
    name: string,
    data: string
}

export type SelectedData = {
    type: SelectedDataType,
    id: string,
}

export enum SelectedDataType {
    room,
    intersection,
    vertex,
    floor_intersection
}

export type EditorSettings = {
    raycastLimit: number;
    raycastStep: number;
}

export type FloorLinkingContext = {
    primaryData: LoadedData,
    primaryMapId: string,
    secondaryData: LoadedData,
    secondaryMapId: string,
    primaryFloorIntersection?: SelectedFloorLinkingIntersection,
    secondaryFloorIntersection?: SelectedFloorLinkingIntersection,
    step: number
}

export type SelectedFloorLinkingIntersection = {
    id: string,
    mapId: string,
    roomId: string,
}
