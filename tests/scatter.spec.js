import { expect, test } from "@playwright/test";

import { layoutBucket } from "../public/scatter.js";

/**
 * Several requirements on one coordinate.
 *
 * The prioritization field plots requirements on a lattice — departments naming
 * one against operations it blocks — and both axes count whole things, so
 * points sharing a coordinate are the normal case. With twenty requirements on
 * a three-by-three lattice a pile of eight is ordinary.
 *
 * They were fanned sideways by a constant fifteen pixels, which was wrong twice
 * over. A dot's radius carries how many citations it rests on and reaches ten,
 * so every neighbouring pair in a fan overlapped by a third of its width —
 * measured in the running chart, nine overlapping pairs out of ten dots. And a
 * fan of ten reached 67.5 pixels from its gridline; with eight departments the
 * gridlines stand 65 apart, so a requirement named by three departments was
 * drawn nearer the line for four.
 *
 * The second is the one that matters. A chart that is hard to read can be read
 * twice; a chart that puts a figure at the wrong coordinate is read once, wrong.
 */

const SLOT = 23; // the widest dot in a chart, ten pixels of radius, plus a gap

test("a pile never leaves the cell it belongs to", () => {
  /* Eight departments put the gridlines 65 apart, so nothing may reach further
     than 32.5 from its own line — beyond that it is nearer somebody else's. */
  const stepX = 65;
  for (const count of [2, 3, 5, 8, 10, 25]) {
    const { places } = layoutBucket(count, { slot: SLOT, stepX });
    const reach = Math.max(...places.map((place) => Math.abs(place.dx)));
    expect(reach, `${count} dots stay inside a ${stepX}px cell`).toBeLessThan(stepX / 2);
  }
});

test("nothing is drawn on top of anything else", () => {
  for (const count of [2, 4, 9, 16, 30]) {
    const { places } = layoutBucket(count, { slot: SLOT, stepX: 240 });
    for (let i = 0; i < places.length; i += 1) {
      for (let j = i + 1; j < places.length; j += 1) {
        const apart = Math.hypot(places[i].dx - places[j].dx, places[i].dy - places[j].dy);
        // Two dots of radius 10 need 20 between their centres; the slot is 23.
        expect(apart, `dots ${i} and ${j} of ${count} keep their distance`).toBeGreaterThanOrEqual(
          SLOT - 0.001,
        );
      }
    }
  }
});

test("a pile that runs out of width wraps downwards", () => {
  // Which is why the caller has to grow the cell: the height it reports is the
  // room the pile needs, and dots drawn on top of each other would be the
  // alternative.
  const narrow = layoutBucket(10, { slot: SLOT, stepX: 65 });
  expect(narrow.perRow).toBe(2);
  expect(narrow.rows).toBe(5);
  expect(narrow.height).toBe(5 * SLOT);

  const wide = layoutBucket(10, { slot: SLOT, stepX: 400 });
  expect(wide.rows).toBe(1);
  expect(wide.height).toBe(SLOT);
});

test("the pile is centred on its coordinate, not hung off one side", () => {
  for (const count of [1, 2, 3, 4, 7]) {
    const { places } = layoutBucket(count, { slot: SLOT, stepX: 240 });
    const middle = places.reduce((sum, place) => sum + place.dx, 0) / count;
    expect(middle, `${count} dots sit around their point`).toBeCloseTo(0, 6);
  }
  expect(layoutBucket(1, { slot: SLOT, stepX: 240 }).places).toEqual([{ dx: 0, dy: 0 }]);
});

test("a dot wider than its own cell is still placed on its own coordinate", () => {
  // Letting it touch its neighbour is a nuisance; drawing it at somebody else's
  // coordinate is a wrong reading.
  const { places, perRow } = layoutBucket(3, { slot: 40, stepX: 20 });
  expect(perRow).toBe(1);
  expect(places.every((place) => place.dx === 0)).toBe(true);
});

/* And the same properties in the chart the interface actually draws. */

test("the drawn field keeps its dots apart and inside their cell", async ({ page, request }) => {
  const existing = await (await request.get("/api/requirements")).json();
  for (const one of existing.requirements ?? existing) {
    await request.delete(`/api/requirements/${one.id}`);
  }
  const data = await (await request.get("/api/interviews/interview-01")).json();
  for (const coding of data.codings) {
    await request.delete(`/api/interviews/interview-01/codings/${coding.id}`);
  }

  // Ten requirements all naming one department and blocking two operations:
  // one pile, which is what the lattice produces all the time.
  const codable = data.turns.filter((turn) => !turn.interviewer && turn.text.length > 70);
  for (let i = 0; i < 10; i += 1) {
    const turn = codable[i];
    const coding = await (
      await request.post("/api/interviews/interview-01/codings", {
        data: {
          turn: turn.number,
          start: 0,
          end: 55,
          category: "routine",
          text: turn.text.slice(0, 55),
          reviewed: true,
        },
      })
    ).json();
    const wanted = await (
      await request.post("/api/requirements", { data: { title: `Anforderung ${i + 1}` } })
    ).json();
    await request.patch(`/api/requirements/${wanted.id}`, {
      data: { blockedOperations: ["filing", "retrieval"] },
    });
    await request.patch(`/api/interviews/interview-01/codings/${coding.id}`, {
      data: { requirements: [wanted.id] },
    });
  }

  await page.goto("/?lang=de");
  await page.locator('.tab[data-view="catalog"]').click();
  await expect(page.locator("#priority svg")).toBeVisible();

  const drawn = await page.evaluate(() => {
    const svg = document.querySelector("#priority svg");
    const vertical = [...svg.querySelectorAll("line.grid")].filter(
      (line) => line.getAttribute("x1") === line.getAttribute("x2"),
    );
    return {
      lines: vertical.map((line) => Number(line.getAttribute("x1"))).sort((a, b) => a - b),
      width: Number(svg.getAttribute("viewBox").split(" ")[2]),
      /* Whatever shape the level gave it: how much room a mark takes is what
         the packing is about, and that is the reach and not the radius. */
      dots: [...svg.querySelectorAll(".point")].map((dot) => ({
        cx: Number(dot.dataset.cx),
        cy: Number(dot.dataset.cy),
        r: Number(dot.dataset.reach),
      })),
    };
  });

  expect(drawn.dots).toHaveLength(10);

  for (let i = 0; i < drawn.dots.length; i += 1) {
    for (let j = i + 1; j < drawn.dots.length; j += 1) {
      const a = drawn.dots[i];
      const b = drawn.dots[j];
      const apart = Math.hypot(a.cx - b.cx, a.cy - b.cy);
      expect(apart, `dot ${i} and dot ${j} do not overlap`).toBeGreaterThanOrEqual(a.r + b.r - 0.5);
    }
  }

  // Every dot is nearer its own gridline than any other, and none is drawn off
  // the edge of the picture.
  const own = drawn.lines[1];
  for (const dot of drawn.dots) {
    const nearest = drawn.lines.reduce((a, b) => (Math.abs(b - dot.cx) < Math.abs(a - dot.cx) ? b : a));
    expect(nearest, "the dot belongs to the gridline it was placed on").toBe(own);
    expect(dot.cx + dot.r).toBeLessThanOrEqual(drawn.width);
    expect(dot.cx - dot.r).toBeGreaterThanOrEqual(0);
  }
});
