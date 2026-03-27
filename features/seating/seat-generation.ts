import type { AssignedSeat, Meeting, SeatDefinition, SeatOrderMode, SeatZone } from "./types";

function leftHonorSequence(count: number) {
  const middle = Math.ceil(count / 2);
  const order: number[] = [];

  for (let offset = 0; order.length < count; offset += 1) {
    const left = middle - offset;
    const right = middle + offset;

    if (offset === 0 && left >= 1 && left <= count) {
      order.push(left);
      continue;
    }

    if (left >= 1) {
      order.push(left);
    }

    if (right <= count) {
      order.push(right);
    }
  }

  return order.slice(0, count);
}

function seatOrderForMode(count: number, mode: SeatOrderMode) {
  return mode === "ltr" ? Array.from({ length: count }, (_, index) => index + 1) : leftHonorSequence(count);
}

function centeredStart(totalCols: number, span: number) {
  return Math.max(1, Math.floor((Math.max(totalCols, span) - span) / 2) + 1);
}

function makeSeat(
  meetingId: string,
  zone: SeatZone,
  areaType: "rostrum" | "audience",
  row: number,
  col: number,
  displayRow: number,
  displayCol: number,
  visualIndex: number,
  orderIndex: number,
  label: string,
) {
  return {
    seatId: `${meetingId}-${zone}-${row}-${col}`,
    meetingId,
    zone,
    row,
    col,
    visualIndex,
    areaType,
    orderIndex,
    displayRow,
    displayCol,
    label,
  } satisfies SeatDefinition;
}

function buildRostrumSeats(meetingId: string, capacity: number, totalDisplayCols: number, displayRow = 1) {
  const priorityOrder = leftHonorSequence(capacity);
  const orderIndexMap = new Map(priorityOrder.map((col, index) => [col, index]));
  const startDisplayCol = centeredStart(totalDisplayCols, capacity);

  return Array.from({ length: capacity }, (_, index) => {
    const col = index + 1;
    const displayCol = startDisplayCol + index;
    return makeSeat(meetingId, "rostrum", "rostrum", 1, col, displayRow, displayCol, displayRow * 100 + displayCol, orderIndexMap.get(col) ?? index, `主席台 ${col}`);
  });
}

export function buildSeatMap(meeting: Meeting): SeatDefinition[] {
  const meetingId = meeting.id;

  switch (meeting.venueConfig.venueType) {
    case "large": {
      const { rostrumCapacity, audienceRows, audienceBlocks, seatOrderMode } = meeting.venueConfig;
      const audiencePerRow = audienceBlocks.reduce((sum, block) => sum + block, 0);
      const totalDisplayCols = audiencePerRow + Math.max(0, audienceBlocks.length - 1);
      const seats = buildRostrumSeats(meetingId, rostrumCapacity, totalDisplayCols, 1);
      const rowOrderMap = new Map(seatOrderForMode(audiencePerRow, seatOrderMode).map((col, index) => [col, index]));
      const blockOffsets = audienceBlocks.map((_, blockIndex) => audienceBlocks.slice(0, blockIndex).reduce((sum, value) => sum + value, 0));

      for (let row = 1; row <= audienceRows; row += 1) {
        for (let col = 1; col <= audiencePerRow; col += 1) {
          let displayCol = col;

          for (let blockIndex = 0; blockIndex < audienceBlocks.length; blockIndex += 1) {
            const blockStart = blockOffsets[blockIndex] + 1;
            const blockEnd = blockStart + audienceBlocks[blockIndex] - 1;
            if (col >= blockStart && col <= blockEnd) {
              displayCol = col + blockIndex;
              break;
            }
          }

          seats.push(
            makeSeat(
              meetingId,
              "audience",
              "audience",
              row,
              col,
              row + 2,
              displayCol,
              row * 100 + displayCol,
              (row - 1) * audiencePerRow + (rowOrderMap.get(col) ?? col - 1),
              `第 ${row} 排 ${col} 座`,
            ),
          );
        }
      }

      return seats;
    }
    case "u_shape": {
      const { rostrumCapacity, leftSeats, rightSeats } = meeting.venueConfig;
      const totalDisplayCols = Math.max(5, rostrumCapacity);
      const seats = buildRostrumSeats(meetingId, rostrumCapacity, totalDisplayCols, 1);

      for (let row = 1; row <= leftSeats; row += 1) {
        seats.push(makeSeat(meetingId, "left", "audience", row, 1, row + 2, 1, row * 10 + 1, row - 1, `左侧 ${row}`));
      }

      for (let row = 1; row <= rightSeats; row += 1) {
        seats.push(makeSeat(meetingId, "right", "audience", row, 1, row + 2, totalDisplayCols, row * 10 + totalDisplayCols, leftSeats + row - 1, `右侧 ${row}`));
      }

      return seats;
    }
    case "hollow_square": {
      const { rostrumCapacity, leftSeats, rightSeats, bottomSeats } = meeting.venueConfig;
      const totalDisplayCols = Math.max(7, bottomSeats + 2, rostrumCapacity);
      const seats = buildRostrumSeats(meetingId, rostrumCapacity, totalDisplayCols, 1);

      for (let row = 1; row <= leftSeats; row += 1) {
        seats.push(makeSeat(meetingId, "left", "audience", row, 1, row + 2, 1, row * 10 + 1, row - 1, `左边 ${row}`));
      }

      for (let row = 1; row <= rightSeats; row += 1) {
        seats.push(makeSeat(meetingId, "right", "audience", row, 1, row + 2, totalDisplayCols, row * 10 + totalDisplayCols, leftSeats + row - 1, `右边 ${row}`));
      }

      const bottomStartCol = centeredStart(totalDisplayCols, bottomSeats);
      for (let col = 1; col <= bottomSeats; col += 1) {
        const displayCol = bottomStartCol + col - 1;
        seats.push(
          makeSeat(
            meetingId,
            "bottom",
            "audience",
            1,
            col,
            Math.max(leftSeats, rightSeats) + 3,
            displayCol,
            500 + displayCol,
            leftSeats + rightSeats + col - 1,
            `底部 ${col}`,
          ),
        );
      }

      return seats;
    }
  }
}

export function sortSeatsForAssignment(seats: SeatDefinition[]) {
  return [...seats].sort((left, right) => left.orderIndex - right.orderIndex);
}

export function mapAssignmentsBySeat(assignments: AssignedSeat[]) {
  return new Map(assignments.map((seat) => [seat.seatId, seat]));
}
