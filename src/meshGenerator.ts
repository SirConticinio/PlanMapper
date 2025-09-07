import {calculateMapCenter, calculateScale, centerAndScaleVector, Vector2D} from "./utils.ts";
import earcut from "earcut";
import {MapData, RoomData} from "./dto.ts";

export function generateObj(mapData: MapData): string {
    // we retrieve the center of the geometry
    const center = calculateMapCenter(mapData);
    const scale = calculateScale(mapData.coordsReferences)

    // and now we generate the object
    let obj: string = "";
    let vertexOffset = 1;
    for (const room of mapData.rooms) {
        const generatedObj = generateObjFromRoom(room, center, scale, vertexOffset, mapData.height);
        obj += generatedObj.data;
        vertexOffset = generatedObj.newVertexOffset;
    }
    return obj;
}

function generateObjFromRoom(roomData: RoomData, center: Vector2D, scale: number, vertexOffset: number, height: number): { data: string, newVertexOffset: number } {
    // Clean the input points
    const cleanedPoints = cleanPolygon(center, scale, roomData.points);
    const vertexCount = cleanedPoints.length;

    // Start the new object for the room
    let obj = `g ${roomData.id}\n`;
    obj += `# ============================\n# ${roomData.name} (${roomData.id}) extruded OBJ (triangulated)\n# ============================\n\n`;

    // Generate vertices (bottom then top)
    cleanedPoints.forEach(p => obj += `v ${p.x} ${p.y} 0\n`); // Bottom
    cleanedPoints.forEach(p => obj += `v ${p.x} ${p.y} ${height}\n`); // Top

    const bottomStart = vertexOffset;
    const topStart = bottomStart + vertexCount;

    // Create side faces (as quads)
    obj += "\n# Side faces\n";
    for (let i = 0; i < vertexCount; i++) {
        const next = (i + 1) % vertexCount;
        obj += `f ${bottomStart + i} ${bottomStart + next} ${topStart + next} ${topStart + i}\n`;
    }

    // Triangulate the cleaned points using Earcut.js
    const triangles = triangulatePolygon(cleanedPoints);

    // Create bottom face (triangulated)
    obj += "\n# Bottom face\n";
    for (let i = 0; i < triangles.length; i += 3) {
        const v1 = bottomStart + triangles[i];
        const v2 = bottomStart + triangles[i + 1];
        const v3 = bottomStart + triangles[i + 2];
        obj += `f ${v1} ${v2} ${v3}\n`;
    }

    // Create top face (triangulated, reversed order)
    obj += "\n# Top face\n";
    for (let i = 0; i < triangles.length; i += 3) {
        const v1 = topStart + triangles[i];
        const v2 = topStart + triangles[i + 1];
        const v3 = topStart + triangles[i + 2];
        obj += `f ${v3} ${v2} ${v1}\n`;  // Reverse for correct normal
    }

    // Update vertex offset for next object
    const newVertexOffset = topStart + vertexCount;
    return { data: obj, newVertexOffset };
}

// triangulate a polygon using Earcut
function triangulatePolygon(points: Vector2D[]): number[] {
    // flatten the points as [x1, y1, x2, y2, ...]
    const coords: number[] = points.flatMap(p => [p.x, p.y]);
    return earcut(coords);
}

function cleanPolygon(center: Vector2D, scale: number, points: Vector2D[]): Vector2D[] {
    // we remove duplicate points, while also centering the whole model in the middle
    // and we also apply a scale! the numbers have to be 1 meter - 1 point
    const cleaned: Vector2D[] = [];
    for (let i = 0; i < points.length; i++) {
        const current = points[i];
        if (i > 0 && current.x === points[i - 1].x && current.y === points[i - 1].y) {
            continue;
        }
        cleaned.push(centerAndScaleVector(current, center, scale));
    }

    // we ensure it's a closed polygon
    const first = cleaned[0];
    const last = cleaned[cleaned.length - 1];
    if (first.x !== last.x || first.y !== last.y) {
        cleaned.push({ ...first });
    }

    return cleaned;
}
