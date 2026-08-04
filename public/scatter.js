/**
 * Where several points that share a coordinate are drawn.
 *
 * The prioritization field plots requirements on a lattice: how many
 * departments name one against how many operations it blocks. Both axes count
 * whole things, so points landing on exactly the same coordinate are the normal
 * case rather than the exception — with twenty requirements and a three-by-three
 * lattice, a pile of eight is ordinary.
 *
 * They were fanned out sideways by a constant fifteen pixels, which was wrong
 * in two ways at once. A dot's radius carries how many citations it rests on
 * and reaches ten, so neighbours in a fan overlapped by a third of their width.
 * And a fan of ten reached sixty-seven pixels from its gridline: with eight
 * departments the gridlines stand sixty-five apart, so a requirement named by
 * three departments was drawn nearer the line for four. A chart that puts a
 * figure at the wrong coordinate is worse than one that is hard to read.
 *
 * So a pile is packed into rows inside its own cell: never wider than the cell,
 * wrapping downwards when it runs out of room, and the caller grows the cell
 * height to fit the tallest pile. The slot is the widest dot plus a gap, so
 * nothing overlaps.
 */

/**
 * Offsets from the lattice point for every dot sharing it.
 *
 * `slot` is the space one dot takes — the widest dot in the whole chart plus a
 * gap, so that the packing is the same everywhere and the eye can compare piles.
 */
export function layoutBucket(count, { slot, stepX }) {
  // Never wider than the cell it belongs to. A single dot too wide for that is
  // still placed on its own coordinate: misplacing it would be worse than
  // letting it touch its neighbour.
  const room = Math.max(slot, stepX * 0.9);
  const perRow = Math.max(1, Math.floor(room / slot));
  const rows = Math.ceil(count / perRow);
  const places = [];
  for (let index = 0; index < count; index += 1) {
    const row = Math.floor(index / perRow);
    const inThisRow = Math.min(perRow, count - row * perRow);
    const at = index - row * perRow;
    places.push({
      dx: (at - (inThisRow - 1) / 2) * slot,
      dy: (row - (rows - 1) / 2) * slot,
    });
  }
  return { places, rows, perRow, width: Math.min(count, perRow) * slot, height: rows * slot };
}
