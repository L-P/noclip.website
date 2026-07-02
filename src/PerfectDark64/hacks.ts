import { SceneRoom } from "./scenes";
import { AABB } from "../Geometry";
import { StageID } from "./stages";
import { vec3, ReadonlyVec3 } from "gl-matrix";

// The original portal-based renderer doesn't make sense when you go OOB so
// room overlaps need to be handled the hacky way.
export function updateHarcodedHacks(
    pos: ReadonlyVec3,
    currentRoom: number,
    stageID: StageID,
    rooms: Map<number, SceneRoom>,
): void {
    switch(stageID) {
        case StageID.Chicago:
            updateChicagoHacks(currentRoom, pos, rooms);
            break;

        case StageID.Villa:
            updateVillaHacks(currentRoom, pos, rooms);
            break;

        case StageID.Extraction:
        case StageID.MisterBlondesRevenge:
        case StageID.Defection:
            updateDDTowerHacks(currentRoom, pos, rooms);
            break;

        case StageID.Defense:
        case StageID.Duel:
            updateInstituteHacks(currentRoom, pos, rooms);
            break;

        case StageID.Infiltration:
        case StageID.Rescue:
        case StageID.Escape:
        case StageID.MaianSOS:
            updateArea51Hacks(currentRoom, pos, rooms);
            break;
    }
}

function updateChicagoHacks(currentRoom: number, pos: ReadonlyVec3, rooms: Map<number, SceneRoom>): void {
    { // Reflections on the street overlap the bar interior.
        const bar = [0x04, 0x05, 0x07, 0x08, 0x09, 0x0d, 0x0e, 0x0a, 0x0b, 0x0c];
        const aboveBar = [0x47, 0x36, 0x34];
        const underground = pos[1] < -16;
        const inBadBBox = aboveBar.includes(currentRoom);
        const inBar = bar.includes(currentRoom);

        aboveBar.forEach(v => {
            const hide = inBar || (inBadBBox && underground);
            rooms.get(v)!.setVisible(!hide);
        });
    }
}

function updateDDTowerHacks(currentRoom: number, pos: ReadonlyVec3, rooms: Map<number, SceneRoom>): void {
    { // There one skybox for the ground floor, one for the others.
        const threshold = -4200;
        const lower = [0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14];
        const upper = [0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c];

        lower.forEach(v => rooms.get(v)!.setVisible(pos[1] <= threshold));
        upper.forEach(v => rooms.get(v)!.setVisible(pos[1] > threshold));
    }

    { // Intro buildings should not be visible unless OOB.
        const intro = [0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7];
        intro.forEach(v => {
            rooms.get(v)!.setVisible(
                intro.includes(currentRoom) || currentRoom === 0x00
            );
        });
    }
}

function updateInstituteHacks(currentRoom: number, pos: ReadonlyVec3, rooms: Map<number, SceneRoom>): void {
    // This place is a mess. Actually implementing portals might be quicker
    // than finding hacky workarounds.
}

function updateArea51Hacks(currentRoom: number, pos: ReadonlyVec3, rooms: Map<number, SceneRoom>): void {
    // The two dissection areas overlap, it's also visible from the rooms leading up to them.
    const sectionA = [0x90, 0x91, 0x92, 0x93, 0x94, 0x99, 0x9a, 0x98, 0x96, 0x97, 0x97, 0x95];
    const sectionB = [0x80, 0x81, 0x82, 0x83, 0x84, 0x89, 0x8a, 0x88, 0x86, 0x87, 0x87, 0x85];
    if (currentRoom === 0x00 || !sectionA.concat(sectionB).includes(currentRoom)) {
        sectionA.forEach(v => rooms.get(v)!.setVisible(true));
        sectionB.forEach(v => rooms.get(v)!.setVisible(true));
        return;
    }

    let sectionAbbox = new AABB();
    let sectionBbbox = new AABB();
    sectionA.forEach(v => sectionAbbox.union(sectionAbbox, rooms.get(v)!.absoluteBBox));
    sectionB.forEach(v => sectionBbbox.union(sectionBbbox, rooms.get(v)!.absoluteBBox));

    const threshold = (sectionAbbox.max[0] + sectionBbbox.min[0]) / 2;
    sectionA.forEach(v => rooms.get(v)!.setVisible(pos[0] < threshold));
    sectionB.forEach(v => rooms.get(v)!.setVisible(pos[0] >= threshold));
}

function updateVillaHacks(currentRoom: number, pos: ReadonlyVec3, rooms: Map<number, SceneRoom>): void {
    // Single floating tri above the map.
    rooms.get(0x58)!.setVisible(false);

    { // Generator and wind turbine rooms overlap.
        const generator = rooms.get(0x72)!;
        const turbine = rooms.get(0x61)!;
        const threshold = -20 + (turbine.absoluteBBox.min[1] + generator.absoluteBBox.max[1]) / 2;

        // Undesirable everywhere above the floor of the turbine room.
        generator.setVisible(pos[1] < threshold);

        // Undesirable when viewed from the generator room and a few rooms leading to it.
        turbine.setVisible(true);
        if (generator.visible) {
            turbine.setVisible(![generator.number, 0x73, 0x74, 0x75].includes(currentRoom));
        }
    }

    { // Minor overlap in kitchen.
        const exterior = rooms.get(0x55)!;
        const inKitchen = [0x10, 0x11, 0x12].includes(currentRoom);
        exterior.setVisible(!inKitchen);
    }
}

