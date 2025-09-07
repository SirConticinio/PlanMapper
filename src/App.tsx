import React from 'react';
import './App.css';
import {AppMode, MapMode} from "./dto.ts";
import MapContainer from "./MapContainer.tsx";
import CampusBuildingCreator from "./CampusBundleCreator.tsx";

function App() {
    console.log("Printing app!!");
    const [appMode, setAppMode] = React.useState<AppMode>(AppMode.map);

    switch (appMode) {
        case AppMode.bundle_creation: return <CampusBuildingCreator appMode={appMode} setAppMode={setAppMode}/>;
        default: return <MapContainer appMode={appMode} setAppMode={setAppMode}/>
    }
}



export default App;
