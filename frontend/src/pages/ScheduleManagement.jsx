import React from "react";
import VehicleManagement from "./VehicleManagement";

/**
 * ScheduleManagement
 * Maintains backwards compatibility for direct URL access (/schedule).
 * Renders the unified Vehicle & Schedule Management page.
 */
const ScheduleManagement = () => {
  return <VehicleManagement />;
};

export default ScheduleManagement;