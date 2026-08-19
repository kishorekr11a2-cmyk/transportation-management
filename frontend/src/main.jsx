import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "leaflet/dist/leaflet.css";
import "./css/global.css";
import "./services/leafletConfig";
ReactDOM.createRoot(
    document.getElementById("root")
).render(
    <App />
);