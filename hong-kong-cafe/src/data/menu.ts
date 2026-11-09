export const WEEKLY_DINNER_MENU = {
  Monday: ["Claypot chicken rice", "Steamed gai lan", "Mango pudding"],
  Tuesday: ["Sweet and sour pork", "Garlic bok choy", "Egg tarts"],
  Wednesday: ["Black pepper beef", "Salt and pepper tofu", "Red bean soup"],
  Thursday: ["Roast duck", "Seasonal greens", "Coconut sago"],
  Friday: ["Steamed fish", "Buddha's delight", "Pineapple buns"],
  Saturday: ["Claypot lamb", "Chive dumplings", "Mango pomelo sago"],
  Sunday: ["Soy sauce chicken", "Wonton soup", "Steamed sponge cake"],
} as const;

export type Weekday = keyof typeof WEEKLY_DINNER_MENU;

export function getDinnerMenu(weekday: Weekday): readonly string[] {
  return WEEKLY_DINNER_MENU[weekday];
}
