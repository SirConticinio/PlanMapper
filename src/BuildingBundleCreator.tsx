import React from 'react';
import {AppMode, BundleBuildingInfo, BundleFloorInfo, DataFile, MapMode, RoomData} from "./dto.ts";
import "./BundleCreator.css"
import {useFilePicker} from "use-file-picker";
import {downloadJson, loadMapData, mapDataToJson, unzipAndLoadData} from "./utils.ts";
import {v4 as uuidv4} from "uuid";

export type BuildingBundleCreatorProps = {
    bundle: BundleBuildingInfo;
    setBundle: React.Dispatch<BundleBuildingInfo>;
};

function BuildingBundleCreator({bundle, setBundle}: BuildingBundleCreatorProps) {
    console.log("Printing building bundle creator!!");

    const {openFilePicker: openZipFilePicker, filesContent: zipFilesContent} = useFilePicker({
        accept: ".zip",
        readAs: "ArrayBuffer"
    });

    if (zipFilesContent.length > 0) {
        const foundZipData = zipFilesContent[0].content;
        zipFilesContent.length = 0;
        unzipAndLoadData(foundZipData).then((result) => {
            if (!result.jsonData) {
                return;
            }

            const mapData = loadMapData(result.jsonData);
            const alreadyAdded = bundle.floors.find(floor => floor.id == mapData.id);
            if (alreadyAdded) {
                alert("You've already added a floor with this ID!");
                return;
            }

            const newBundle = {
                ...bundle,
                floors: [...bundle.floors, {
                    id: mapData.id,
                    name: mapData.name,
                    number: bundle.floors.length,
                    isGroundFloor: bundle.floors.length == 0,
                    version: mapData.version
                } as BundleFloorInfo]
            };
            newBundle.floors = newBundle.floors.sort((a, b) => a.number - b.number);
            setBundle(newBundle);
        });
    }

    function addNewBundledFloor() {
        openZipFilePicker();
    }

    function handleBlur() {
        setBundle({
            ...bundle,
            floors: [...bundle.floors].sort((a, b) => a.number - b.number),
        });
    }

    function handleBuildingNameChange(e: React.ChangeEvent<HTMLInputElement>) {
        setBundle({
            ...bundle,
            name: e.target.value
        });
    }

    function handleVersionChange(e: React.ChangeEvent<HTMLInputElement>, floorInfo: BundleFloorInfo) {
        updateFloorInfo(floorInfo, {
            ...floorInfo,
            version: Number(e.target.value)
        });
    }

    function handleFloorIdChange(e: React.ChangeEvent<HTMLInputElement>, floorInfo: BundleFloorInfo) {
        updateFloorInfo(floorInfo, {
            ...floorInfo,
            id: e.target.value
        })
    }

    function handleFloorNameChange(e: React.ChangeEvent<HTMLInputElement>, floorInfo: BundleFloorInfo) {
        updateFloorInfo(floorInfo, {
            ...floorInfo,
            name: e.target.value
        })
    }

    function handleFloorNumberChange(e: React.ChangeEvent<HTMLInputElement>, floorInfo: BundleFloorInfo) {
        updateFloorInfo(floorInfo, {
            ...floorInfo,
            number: Number(e.target.value)
        })
    }

    function handleGroundFloorChange(floorInfo: BundleFloorInfo) {
        setBundle({
            ...bundle,
            floors: bundle.floors.map((floor) =>
                ({...floor, isGroundFloor: floor === floorInfo})
            ),
        });
    }

    function updateFloorInfo(originalFloorInfo: BundleFloorInfo, newFloorInfo: BundleFloorInfo) {
        // update room data within the map data
        setBundle({
            ...bundle,
            floors: bundle.floors.map((floor) =>
                floor === originalFloorInfo ? newFloorInfo : floor
            ),
        });
    }

    function removeFloor(floorInfo: BundleFloorInfo) {
        setBundle({
            ...bundle,
            floors: bundle.floors.filter((floor) => floor.id != floorInfo.id),
        });
    }

    return (
        <>
            <div>
                <label htmlFor="name">Building's name</label>
                <input
                    id="name"
                    name="name"
                    type="text"
                    value={bundle.name}
                    onChange={handleBuildingNameChange}
                    placeholder="Type the building's name..."
                />
            </div>

            <p>List of floors:</p>
            <ul>
                {bundle.floors.map((floor, index) =>
                    (<li className="bundleElements">
                        <span>[{floor.number}]</span>
                        <div>
                            <label htmlFor={"floorId" + index}>Floor's ID</label>
                            <input
                                id={"floorId" + index}
                                name="floorId"
                                type="text"
                                value={floor.id}
                                onChange={(e) => handleFloorIdChange(e, floor)}
                                placeholder="Type the floor's ID..."
                            />
                        </div>
                        <div>
                            <label htmlFor={"floorName" + index}>Floor's name</label>
                            <input
                                id={"floorName" + index}
                                name="floorName"
                                type="text"
                                value={floor.name}
                                onChange={(e) => handleFloorNameChange(e, floor)}
                                placeholder="Type the floor's name..."
                            />
                        </div>
                        <div>
                            <label htmlFor={"floorNumber" + index}>Floor's number</label>
                            <input
                                id={"floorNumber" + index}
                                name="floorNumber"
                                type="number"
                                value={floor.number}
                                onChange={(e) => handleFloorNumberChange(e, floor)}
                                placeholder="Type the floor's number..."
                                onBlur={handleBlur}
                            />
                        </div>
                        <div>
                            <label htmlFor={"floorGround" + index}>Is ground floor?</label>
                            <input
                                id={"floorGround" + index}
                                name="floorGround"
                                type="checkbox"
                                checked={floor.isGroundFloor}
                                onChange={(e) => handleGroundFloorChange(floor)}
                            />
                        </div>
                        <label htmlFor={"version" + index}>Version</label>
                        <input
                            id={"version" + index}
                            name="version"
                            type="number"
                            value={floor.version}
                            onChange={(e) => handleVersionChange(e, floor)}
                        />
                        <button onClick={() => removeFloor(floor)}>[X] Remove floor</button>
                    </li>)
                )}
            </ul>

            <button onClick={addNewBundledFloor}>[+] Add new floor from map bundle</button>
        </>
    )
}

export default BuildingBundleCreator;
