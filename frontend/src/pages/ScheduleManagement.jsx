import React from "react";
import VehicleManagement from "./VehicleManagement";

/**
 * ScheduleManagement
 * Maintains backwards compatibility for direct URL access (/schedule).
 * Reuses the redesigned unified Vehicle & Schedule Management component
 * with the Schedule tab active by default.
 */
const ScheduleManagement = () => {
  return <VehicleManagement initialTab="schedules" />;
};

export default ScheduleManagement;