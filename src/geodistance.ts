// Adapted from a GitHub gist, https://gist.github.com/ievans3024/af673185ad3e26dc7d48dcf0aa30922c

import {Vector2D} from "./utils.ts";

/**
 * Convert a Coordinate Point in degrees to a Coordinate Point in radians
 * @param point {CoordinatePoint} the Coordinate Point with latitude and longitude expressed as degrees
 * @returns {CoordinatePoint} coordinate point with latitude and longitude expressed as radians
 */
const convertToRadians = (point: Vector2D): Vector2D => {
    const DEGREE_DIVIDER = 57.29577951308232;
    return {
        x: point.x / DEGREE_DIVIDER,
        y: point.y / DEGREE_DIVIDER,
    };
};

/**
 * Measure the distance between two latitude/longitude coordinates. Uses great circle formula.
 * @param from {CoordinatePoint} the first coordinate point
 * @param to {CoordinatePoint} the second coordinate point
 * @param precision {number} the decimal precision to use for the returned value, default is 2
 * @param radius {EarthRadius} the radius by which to multiply the result, default is 3963.0 (returns miles)
 * @returns {number} the distance between the two supplied coordinate points
 */
export const getGpsDistance = (
    from: Vector2D,
    to: Vector2D,
    precision: number = 3,
): number => {
    // convert coordinate point units from degrees to radians
    const point1: Vector2D = convertToRadians(from);
    const point2: Vector2D = convertToRadians(to);

    // measure the distance between the two points in radians
    const result: number = Math.acos(
        (Math.sin(point1.x) * Math.sin(point2.x))
        + (Math.cos(point1.x) * Math.cos(point2.x) * Math.cos(point1.y - point2.y)),
    );

    // convert the distance in radians to the target unit of measurement
    const distance = 6378000.0 * result;

    // round the distance to the desired precision
    return parseFloat(distance.toFixed(precision));
};
