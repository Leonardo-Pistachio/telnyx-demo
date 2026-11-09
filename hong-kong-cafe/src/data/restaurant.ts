export const RESTAURANT = {
  name: "Hong Kong Cafe",
  address: "12 Example Street, Central, Hong Kong",
  openingTime: "11:30",
  closingTime: "22:00",
  lastReservationTime: "20:30",
  capacity: 40,
  timezone: "Asia/Hong_Kong",
  openingDays: "daily",
} as const;

export type RestaurantInfoTopic = "hours" | "address";

export function getRestaurantInfo(topic: RestaurantInfoTopic): string {
  if (topic === "address") return RESTAURANT.address;

  return `${RESTAURANT.name} is open ${RESTAURANT.openingDays} from ${RESTAURANT.openingTime} to ${RESTAURANT.closingTime}. The last reservation is at ${RESTAURANT.lastReservationTime}.`;
}
