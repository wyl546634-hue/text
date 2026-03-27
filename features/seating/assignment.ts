import type { AdjacencyRuleMode, AssignedSeat, GroupMode, Meeting, Person, SeatDefinition, SeparationRule } from "./types";
import { buildSeatMap, sortSeatsForAssignment } from "./seat-generation";

function sortByPriority(people: Person[]) {
  return [...people].sort((left, right) => left.priority - right.priority || left.name.localeCompare(right.name, "zh-CN"));
}

function sortByPriorityWithLineOverride(people: Person[], lineOrder: Map<string, number>) {
  return [...people].sort((left, right) => {
    const lineCompare = (lineOrder.get(left.lineId ?? "") ?? 999) - (lineOrder.get(right.lineId ?? "") ?? 999);
    if (lineCompare !== 0) {
      return lineCompare;
    }

    return left.priority - right.priority || left.name.localeCompare(right.name, "zh-CN");
  });
}

function buildOrderMap(ids: string[]) {
  return new Map(ids.map((id, index) => [id, index]));
}

function buildLineOrderMap(meeting: Meeting) {
  const overrideMap = new Map(meeting.seatingRules.linePriorityOverrides.map((item) => [item.lineId, item.rank]));
  return new Map(
    meeting.lines
      .map((line, index) => ({
        id: line.id,
        sortKey: overrideMap.has(line.id) ? (overrideMap.get(line.id) ?? index + 100) : 1000 + index,
      }))
      .sort((left, right) => left.sortKey - right.sortKey)
      .map((item, index) => [item.id, index]),
  );
}

function conflictsWithPrevious(previous: Person | undefined, candidate: Person, mode: AdjacencyRuleMode) {
  if (!previous || mode === "none") {
    return false;
  }

  if (mode === "region") {
    return Boolean(previous.regionId) && previous.regionId === candidate.regionId;
  }

  return Boolean(previous.lineId) && previous.lineId === candidate.lineId;
}

function applyAdjacencyRule(people: Person[], mode: AdjacencyRuleMode) {
  if (mode === "none" || people.length <= 2) {
    return people;
  }

  const remaining = [...people];
  const arranged: Person[] = [];

  while (remaining.length > 0) {
    const previous = arranged[arranged.length - 1];
    const candidateIndex = remaining.findIndex((person) => !conflictsWithPrevious(previous, person, mode));
    const nextIndex = candidateIndex >= 0 ? candidateIndex : 0;
    arranged.push(remaining[nextIndex]);
    remaining.splice(nextIndex, 1);
  }

  return arranged;
}

function areSeparated(people: Person[], rule: SeparationRule) {
  const firstIndex = people.findIndex((person) => person.id === rule.firstPersonId);
  const secondIndex = people.findIndex((person) => person.id === rule.secondPersonId);
  if (firstIndex < 0 || secondIndex < 0) {
    return true;
  }

  return Math.abs(firstIndex - secondIndex) > 1;
}

function applySeparationRules(people: Person[], rules: SeparationRule[]) {
  if (rules.length === 0 || people.length <= 2) {
    return people;
  }

  const arranged = [...people];

  rules.forEach((rule) => {
    if (areSeparated(arranged, rule)) {
      return;
    }

    const firstIndex = arranged.findIndex((person) => person.id === rule.firstPersonId);
    const secondIndex = arranged.findIndex((person) => person.id === rule.secondPersonId);
    const targetIndex = Math.max(firstIndex, secondIndex);

    for (let scanIndex = targetIndex + 1; scanIndex < arranged.length; scanIndex += 1) {
      const swapped = [...arranged];
      const [moved] = swapped.splice(targetIndex, 1);
      swapped.splice(scanIndex, 0, moved);
      if (areSeparated(swapped, rule)) {
        arranged.splice(0, arranged.length, ...swapped);
        return;
      }
    }
  });

  return arranged;
}

function compareByMode(
  left: Person,
  right: Person,
  mode: GroupMode,
  regionOrder: Map<string, number>,
  lineOrder: Map<string, number>,
) {
  if (mode === "region" || mode === "region+line") {
    const regionCompare = (regionOrder.get(left.regionId ?? "") ?? 999) - (regionOrder.get(right.regionId ?? "") ?? 999);
    if (regionCompare !== 0) {
      return regionCompare;
    }
  }

  if (mode === "line" || mode === "region+line") {
    const lineCompare = (lineOrder.get(left.lineId ?? "") ?? 999) - (lineOrder.get(right.lineId ?? "") ?? 999);
    if (lineCompare !== 0) {
      return lineCompare;
    }
  }

  return left.priority - right.priority || left.name.localeCompare(right.name, "zh-CN");
}

function sortAudiencePeople(meeting: Meeting, people: Person[]) {
  const config = meeting.venueConfig;
  const lineOrder = buildLineOrderMap(meeting);
  if (config.groupMode === "none") {
    return applySeparationRules(
      applyAdjacencyRule(sortByPriorityWithLineOverride(people, lineOrder), meeting.seatingRules.adjacencyMode),
      meeting.seatingRules.separationRules,
    );
  }

  const regionOrder = buildOrderMap(meeting.regions.map((region) => region.id));
  const mode: GroupMode = config.groupMode;

  return applySeparationRules(
    applyAdjacencyRule([...people].sort((left, right) => compareByMode(left, right, mode, regionOrder, lineOrder)), meeting.seatingRules.adjacencyMode),
    meeting.seatingRules.separationRules,
  );
}

function assignInOrder(seats: SeatDefinition[], people: Person[]) {
  const sortedSeats = sortSeatsForAssignment(seats);

  return sortedSeats.map((seat, index) => ({
    ...seat,
    person: people[index],
  })) satisfies AssignedSeat[];
}

function assignLargeAudienceWithLineZones(meeting: Meeting, seats: SeatDefinition[], people: Person[]) {
  const sortedSeats = sortSeatsForAssignment(seats);
  const assignedBySeatId = new Map<string, Person | undefined>();
  const usedPersonIds = new Set<string>();
  const sortedPeople = sortAudiencePeople(meeting, people);

  if (meeting.venueConfig.venueType !== "large") {
    return assignInOrder(sortedSeats, sortedPeople);
  }

  if (meeting.venueConfig.groupMode !== "line" || meeting.venueConfig.lineZones.length === 0) {
    return assignInOrder(sortedSeats, sortedPeople);
  }

  const zones = [...meeting.venueConfig.lineZones].sort(
    (left, right) =>
      left.startRow - right.startRow || left.startCol - right.startCol || left.endRow - right.endRow || left.endCol - right.endCol,
  );

  zones.forEach((zone) => {
    const zoneSeats = sortedSeats.filter(
      (seat) =>
        seat.row >= zone.startRow &&
        seat.row <= zone.endRow &&
        seat.col >= zone.startCol &&
        seat.col <= zone.endCol &&
        !assignedBySeatId.has(seat.seatId),
    );

    const zonePeople = sortedPeople.filter((person) => person.lineId === zone.lineId && !usedPersonIds.has(person.id));
    zoneSeats.forEach((seat, index) => {
      const person = zonePeople[index];
      if (!person) {
        return;
      }

      assignedBySeatId.set(seat.seatId, person);
      usedPersonIds.add(person.id);
    });
  });

  const remainingPeople = sortedPeople.filter((person) => !usedPersonIds.has(person.id));
  let remainderIndex = 0;

  sortedSeats.forEach((seat) => {
    if (assignedBySeatId.has(seat.seatId)) {
      return;
    }

    assignedBySeatId.set(seat.seatId, remainingPeople[remainderIndex]);
    remainderIndex += 1;
  });

  return sortedSeats.map((seat) => ({
    ...seat,
    person: assignedBySeatId.get(seat.seatId),
  })) satisfies AssignedSeat[];
}

function groupPeopleByRegion(meeting: Meeting, people: Person[], mode: GroupMode) {
  const regionOrder = meeting.regions.map((region) => region.id);
  const lineOrderMap = buildLineOrderMap(meeting);
  const regionOrderMap = buildOrderMap(regionOrder);

  return regionOrder
    .map((regionId) =>
      people
        .filter((person) => person.regionId === regionId)
        .sort((left, right) => compareByMode(left, right, mode, regionOrderMap, lineOrderMap)),
    )
    .filter((group) => group.length > 0);
}

function assignUShapeSequentially(seats: SeatDefinition[], people: Person[]) {
  const leftSeats = sortSeatsForAssignment(seats.filter((seat) => seat.zone === "left"));
  const rightSeats = sortSeatsForAssignment(seats.filter((seat) => seat.zone === "right"));
  const orderedSeats: SeatDefinition[] = [];
  const maxRows = Math.max(leftSeats.length, rightSeats.length);

  for (let index = 0; index < maxRows; index += 1) {
    if (leftSeats[index]) {
      orderedSeats.push(leftSeats[index]);
    }

    if (rightSeats[index]) {
      orderedSeats.push(rightSeats[index]);
    }
  }

  return orderedSeats.map((seat, index) => ({
    ...seat,
    person: people[index],
  })) satisfies AssignedSeat[];
}

function assignAudienceByZones(meeting: Meeting, seats: SeatDefinition[], people: Person[]) {
  const config = meeting.venueConfig;
  if (config.venueType === "large" || config.groupMode === "none" || (config.groupMode !== "region" && config.groupMode !== "region+line")) {
    return assignInOrder(seats, people);
  }

  const zoneNames =
    config.venueType === "u_shape"
      ? (["left", "right"] as const)
      : (["left", "right", "bottom"] as const);

  const seatsByZone = zoneNames.map((zone) => sortSeatsForAssignment(seats.filter((seat) => seat.zone === zone)));
  const groupedPeople = groupPeopleByRegion(meeting, people, config.groupMode);

  if (config.venueType === "u_shape" && groupedPeople.length <= 1) {
    return assignUShapeSequentially(seats, people);
  }

  const peopleByZone = zoneNames.map(() => [] as Person[]);

  groupedPeople.forEach((group, index) => {
    peopleByZone[index % peopleByZone.length].push(...group);
  });

  const assignedSeats: AssignedSeat[] = [];
  seatsByZone.forEach((zoneSeats, zoneIndex) => {
    zoneSeats.forEach((seat, seatIndex) => {
      assignedSeats.push({
        ...seat,
        person: peopleByZone[zoneIndex][seatIndex],
      });
    });
  });

  return assignedSeats;
}

export function assignMeetingSeats(meeting: Meeting) {
  const seats = buildSeatMap(meeting);
  const activePeople = meeting.people.filter((person) => person.status === "normal");
  const rostrumPeople = sortByPriority(activePeople.filter((person) => person.areaType === "rostrum"));
  const audiencePeople = sortAudiencePeople(
    meeting,
    activePeople.filter((person) => person.areaType === "audience"),
  );

  const rostrumSeats = seats.filter((seat) => seat.areaType === "rostrum");
  const audienceSeats = seats.filter((seat) => seat.areaType === "audience");

  const rostrumAssignments = assignInOrder(rostrumSeats, rostrumPeople);
  const audienceAssignments =
    meeting.venueConfig.venueType === "large"
      ? assignLargeAudienceWithLineZones(meeting, audienceSeats, audiencePeople)
      : assignAudienceByZones(meeting, audienceSeats, audiencePeople);

  return [...rostrumAssignments, ...audienceAssignments].sort(
    (left, right) => left.displayRow - right.displayRow || left.displayCol - right.displayCol,
  );
}

export function swapPeopleBySeats(meeting: Meeting, assignments: AssignedSeat[], activeSeatId: string, overSeatId: string) {
  const occupancy = new Map(assignments.map((seat) => [seat.seatId, seat.person?.id]));
  const activePersonId = occupancy.get(activeSeatId);
  const overPersonId = occupancy.get(overSeatId);

  occupancy.set(activeSeatId, overPersonId);
  occupancy.set(overSeatId, activePersonId);

  const nextPeople = meeting.people.map((person) => ({ ...person }));
  const nextById = new Map(nextPeople.map((person) => [person.id, person]));

  const rostrumSeats = sortSeatsForAssignment(assignments.filter((seat) => seat.areaType === "rostrum"));
  const audienceSeats = sortSeatsForAssignment(assignments.filter((seat) => seat.areaType === "audience"));

  const assignedPersonIds = new Set<string>();
  let rostrumPriority = 1;
  let audiencePriority = 1;

  rostrumSeats.forEach((seat) => {
    const personId = occupancy.get(seat.seatId);
    if (!personId) {
      return;
    }

    const person = nextById.get(personId);
    if (!person) {
      return;
    }

    person.areaType = "rostrum";
    person.priority = rostrumPriority;
    rostrumPriority += 1;
    assignedPersonIds.add(personId);
  });

  audienceSeats.forEach((seat) => {
    const personId = occupancy.get(seat.seatId);
    if (!personId) {
      return;
    }

    const person = nextById.get(personId);
    if (!person) {
      return;
    }

    person.areaType = "audience";
    person.priority = audiencePriority;
    audiencePriority += 1;
    assignedPersonIds.add(personId);
  });

  const remainingRostrum = sortByPriority(
    nextPeople.filter((person) => person.status === "normal" && person.areaType === "rostrum" && !assignedPersonIds.has(person.id)),
  );
  remainingRostrum.forEach((person) => {
    person.priority = rostrumPriority;
    rostrumPriority += 1;
  });

  const remainingAudience = sortByPriority(
    nextPeople.filter((person) => person.status === "normal" && person.areaType === "audience" && !assignedPersonIds.has(person.id)),
  );
  remainingAudience.forEach((person) => {
    person.priority = audiencePriority;
    audiencePriority += 1;
  });

  return {
    ...meeting,
    people: nextPeople,
    updatedAt: new Date().toISOString(),
  };
}
