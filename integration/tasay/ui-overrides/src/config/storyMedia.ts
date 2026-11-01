import auditoriumImage from "../assets/opto-c118-audience-v2.jpg";
import campusMap from "../assets/opto-location-map.svg";

// Resolve at render time too: older saves may contain the previous image URL.
export const monitorImageUrl = auditoriumImage;
export const storyLocation = {
  name: "华科光电大楼",
  address: "华中科技大学 · 光电信息大楼 C118 报告厅",
  mapUrl: campusMap,
} as const;
