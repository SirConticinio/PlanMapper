import React from 'react';
import {AppMode, BundleBuildingInfo, DataFile, MapMode, RoomData} from "./dto.ts";
import "./BundleCreator.css"
import {useFilePicker} from "use-file-picker";
import {downloadJson, loadMapData, mapDataToJson, unzipAndLoadData} from "./utils.ts";
import { v4 as uuidv4 } from "uuid";
import BuildingBundleCreator from "./BuildingBundleCreator.tsx";

export type BundleCreatorProps = {
    appMode: AppMode;
    setAppMode: React.Dispatch<React.SetStateAction<AppMode>>;
};

type BundleCampusInfo = {
    id: string,
    name: string,
    buildings: BundleBuildingInfo[],
    version: number
}

function CampusBundleCreator({ appMode, setAppMode }: BundleCreatorProps) {
    console.log("Printing campus creator!!");
    const [bundle, setBundle] = React.useState<BundleCampusInfo>({
        id: uuidv4(),
        name: "",
        buildings: [],
        version: 1
    });

    const { openFilePicker: openBundleFilePicker, filesContent: bundleFilesContent } = useFilePicker({
        accept: ".json",
    });

    if (bundleFilesContent.length > 0) {
        const bundleData = JSON.parse(bundleFilesContent[0].content) as BundleCampusInfo;
        bundleFilesContent.length = 0;
        bundleData.version = bundleData.version ?? 1;
        setBundle(bundleData);
    }

    function addNewBlankBuilding() {
        const blankBuilding = {
            id: uuidv4(),
            name: "",
            floors: []
        } as BundleBuildingInfo;
        setBundle({
            ...bundle,
            buildings: [...bundle.buildings, blankBuilding]
        });
    }

    function returnToMap() {
        setAppMode(AppMode.map);
    }

    function loadCampusBundle() {
        openBundleFilePicker();
    }

    function downloadCampusBundle() {
        const data = JSON.stringify(bundle, null, 2);
        const cleanedName = bundle.name.toLowerCase().replace(/[^a-z0-9]/g, '');
        downloadJson(data, cleanedName + "_" + bundle.id);
    }

    function handleCampusNameChange(e: React.ChangeEvent<HTMLInputElement>) {
        setBundle({
            ...bundle,
            name: e.target.value
        });
    }

    function handleVersionChange(e: React.ChangeEvent<HTMLInputElement>) {
        setBundle({
            ...bundle,
            version: Number(e.target.value)
        });
    }

    function updateBuildingInfo(originalPartInfo: BundleBuildingInfo, newPartInfo: BundleBuildingInfo) {
        // update room data within the map data
        setBundle({
            ...bundle,
            buildings: bundle.buildings.map((building) =>
                building === originalPartInfo ? newPartInfo : building
            ),
        });
    }

    function removeBuilding(building: BundleBuildingInfo) {
        setBundle({
            ...bundle,
            buildings: bundle.buildings.filter((checkBuilding) => building.id != checkBuilding.id),
        });
    }

    return (
        <>
            <div id="headerBar">
                <h1>PlanMapper</h1>
                <button onClick={returnToMap}>Return to map</button>
                <button onClick={loadCampusBundle}>Load campus bundle</button>
                <button onClick={downloadCampusBundle}>Download campus bundle</button>
            </div>

            <div id="bundleContainer">
                <p>Welcome to the building bundle creator!</p>
                <div>
                    <label htmlFor="name">Campus's name</label>
                    <input
                        id="name"
                        name="name"
                        type="text"
                        value={bundle.name}
                        onChange={handleCampusNameChange}
                        placeholder="Type the campus's name..."
                    />
                </div>
                <div>
                    <label htmlFor="version">Version</label>
                    <input
                        id="version"
                        name="version"
                        type="number"
                        value={bundle.version}
                        onChange={handleVersionChange}
                    />
                </div>

                <p>List of buildings:</p>
                <ul>
                    {bundle.buildings.map((building, index) =>
                        (<>
                            <li className="buildingListItem">
                                <BuildingBundleCreator bundle={building} setBundle={(newBuilding) => updateBuildingInfo(building, newBuilding)} />
                                <button onClick={() => removeBuilding(building)}>[X] Remove building</button>
                            </li>
                            <hr/>
                        </>)
                    )}
                </ul>

                <button onClick={addNewBlankBuilding}>[+] Add new building</button>
            </div>
        </>
    )
}

export default CampusBundleCreator;
