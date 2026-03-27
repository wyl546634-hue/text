export type VenueType = "large" | "u_shape" | "hollow_square";
export type SeatOrderMode = "left-honor" | "ltr";
export type GroupMode = "none" | "region" | "line" | "region+line";
export type AdjacencyRuleMode = "none" | "region" | "line";
export type PersonStatus = "normal" | "absent";
export type AreaType = "rostrum" | "audience";
export type SeatZone =
  | "rostrum"
  | "audience"
  | "left"
  | "right"
  | "bottom"
  | "block";

export interface Region {
  id: string;
  name: string;
  color: string;
}

export interface LineGroup {
  id: string;
  name: string;
  color: string;
}

export interface Person {
  id: string;
  name: string;
  title: string;
  priority: number;
  status: PersonStatus;
  areaType: AreaType;
  regionId?: string;
  lineId?: string;
}

export interface SeparationRule {
  id: string;
  firstPersonId: string;
  secondPersonId: string;
}

export interface LinePriorityOverride {
  lineId: string;
  rank: number;
}

export interface SeatingRules {
  adjacencyMode: AdjacencyRuleMode;
  separationRules: SeparationRule[];
  linePriorityOverrides: LinePriorityOverride[];
}

export interface LineZonePreset {
  id: string;
  lineId: string;
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
}

export interface LargeVenueConfig {
  venueType: "large";
  rostrumCapacity: number;
  audienceRows: number;
  audienceBlocks: number[];
  seatOrderMode: SeatOrderMode;
  groupMode: GroupMode;
  lineZones: LineZonePreset[];
}

export interface UShapeVenueConfig {
  venueType: "u_shape";
  rostrumCapacity: number;
  leftSeats: number;
  rightSeats: number;
  groupMode: GroupMode;
}

export interface HollowSquareVenueConfig {
  venueType: "hollow_square";
  rostrumCapacity: number;
  leftSeats: number;
  rightSeats: number;
  bottomSeats: number;
  innerWidth: number;
  innerHeight: number;
  groupMode: GroupMode;
}

export type VenueConfig =
  | LargeVenueConfig
  | UShapeVenueConfig
  | HollowSquareVenueConfig;

export interface Meeting {
  id: string;
  name: string;
  time: string;
  location: string;
  organizer: string;
  isPublished: boolean;
  venueConfig: VenueConfig;
  people: Person[];
  seatingRules: SeatingRules;
  regions: Region[];
  lines: LineGroup[];
  createdAt: string;
  updatedAt: string;
}

export interface SeatAssignment {
  seatId: string;
  meetingId: string;
  personId?: string;
  zone: SeatZone;
  row: number;
  col: number;
  visualIndex: number;
}

export interface SeatDefinition extends SeatAssignment {
  areaType: AreaType;
  orderIndex: number;
  displayRow: number;
  displayCol: number;
  label: string;
}

export interface AssignedSeat extends SeatDefinition {
  person?: Person;
}

export interface MeetingSnapshot {
  version: number;
  selectedMeetingId: string;
  meetings: Meeting[];
}

export interface MeetingPublicState {
  selectedMeetingId: string;
  publishedMeetingIds: string[];
}

export interface ImportResult {
  people: Person[];
  warnings: string[];
}

export type DuplicateHandling = "skip" | "overwrite" | "keep";
export type UserRole = "admin" | "member";

export interface ImportOptions {
  defaultAreaType: AreaType;
  duplicateHandling: DuplicateHandling;
  existingPeople: Person[];
}

export interface VisionRecognitionPerson {
  name: string;
  title: string;
  areaType: AreaType;
  regionName?: string;
  lineName?: string;
  priority?: number;
}

export interface VisionRecognitionResult {
  venueType?: VenueType;
  confidence?: number;
  summary: string;
  rostrumPeople: VisionRecognitionPerson[];
  audiencePeople: VisionRecognitionPerson[];
}

export interface UserProfile {
  id: string;
  email: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
}

export interface MeetingRecord {
  id: string;
  name: string;
  time: string;
  location: string;
  organizer: string;
  is_published?: boolean;
  venue_config: VenueConfig;
  seating_rules: SeatingRules;
  people: Person[];
  regions: Region[];
  lines: LineGroup[];
  created_at: string;
  updated_at: string;
}
