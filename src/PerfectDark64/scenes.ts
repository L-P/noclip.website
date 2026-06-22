import { IS_DEVELOPMENT } from "../BuildVersion";
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, GfxVertexBufferFrequency, GfxWrapMode, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import { SceneContext } from "../SceneBase";
import * as Viewer from "../viewer";
import ROM from "./rom";
import { BGSegment} from "./bg";

const pathBase = `PerfectDark64`;

class Scene implements Viewer.SceneGfx {
    constructor(
        private sceneContext: SceneContext,
        private readonly seg: BGSegment,
    ) {
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
    }

    public destroy(device: GfxDevice): void {
    }
}

class SceneDesc implements Viewer.SceneDesc {
    constructor(
        public id: string,
        public name: string,
        public bgSegmentPath: string,
    ) {
    }

    public async createScene(device: GfxDevice, sceneContext: SceneContext): Promise<Viewer.SceneGfx> {
        const bgJSON = await sceneContext.dataFetcher.fetchData(`${pathBase}/${this.bgSegmentPath}.json`);

        return new Scene(sceneContext, BGSegment.fromJSON(bgJSON));
    }
}

export const sceneGroup: Viewer.SceneGroup = {
    id: "PerfectDark64",
    name: "Perfect Dark",

    // FIXME: Only background geometry is loaded for now so missions that reuse
    // BGs and only differ by pads/setups are strict duplicates.
    // There are a bunch of test maps leftovers but they're all the same two
    // planes, not worth including.
    sceneDescs: [
        "Mission 1",
        new SceneDesc("mission_01_01", "dataDyne Central - Defection", "bgdata/bg_ame.seg"),
        new SceneDesc("mission_01_02", "dataDyne Research - Investigation", "bgdata/bg_ear.seg"),
        new SceneDesc("mission_01_03", "dataDyne Central - Extraction", "bgdata/bg_ame.seg"),
        "Mission 2",
        new SceneDesc("mission_02_01", "Carrington Villa - Hostage One", "bgdata/bg_eld.seg"),
        "Mission 3",
        new SceneDesc("mission_03_01", "Chicago - Stealth", "bgdata/bg_pete.seg"),
        new SceneDesc("mission_03_02", "G5 Building - Reconnaissance", "bgdata/bg_depo.seg"),
        "Mission 4",
        new SceneDesc("mission_04_01", "Area 51 - Infiltration", "bgdata/bg_lue.seg"),
        new SceneDesc("mission_04_02", "Area 51 - Rescue", "bgdata/bg_lue.seg"),
        new SceneDesc("mission_04_03", "Area 51 - Escape", "bgdata/bg_lue.seg"),
        "Mission 5",
        new SceneDesc("mission_05_01", "Air Base - Espionage", "bgdata/bg_cave.seg"),
        new SceneDesc("mission_05_02", "Air Force One - Antiterrorism", "bgdata/bg_rit.seg"),
        new SceneDesc("mission_05_03", "Crash Site - Confrontation", "bgdata/bg_azt.seg"),
        "Mission 6",
        new SceneDesc("mission_06_01", "Pelagic II - Exploration", "bgdata/bg_dam.seg"),
        new SceneDesc("mission_06_02", "Deep Sea - Nullify Threat", "bgdata/bg_pam.seg"),
        "Mission 7",
        new SceneDesc("mission_07_01", "Carrington Institute - Defense", "bgdata/bg_dish.seg"),
        "Mission 8",
        new SceneDesc("mission_08_01", "Attack Ship - Covert Assault", "bgdata/bg_lee.seg"),
        "Mission 9",
        new SceneDesc("mission_09_01", "Skedar Ruins - Battle Shrine", "bgdata/bg_sho.seg"),
        "Special Assignments",
        new SceneDesc("mission_10_01", "Mr. Blonde's Revenge", "bgdata/bg_ame.seg"),
        new SceneDesc("mission_10_02", "Maian SOS", "bgdata/bg_lue.seg"),
        new SceneDesc("mission_10_03", "WAR!", "bgdata/bg_sho.seg"),
        new SceneDesc("mission_10_04", "The Duel", "bgdata/bg_dish.seg"),

        "Multiplayer - Dark",
         new SceneDesc("mp_mp3", "Area 52", "bgdata/bg_mp3.seg"),
         new SceneDesc("mp_mp1", "Base", "bgdata/bg_mp1.seg"),
         new SceneDesc("mp_mp5", "Car Park", "bgdata/bg_mp5.seg"),
         new SceneDesc("mp_mp12", "Fortress", "bgdata/bg_mp12.seg"),
         new SceneDesc("mp_cryp", "G5 Building", "bgdata/bg_cryp.seg"),
         new SceneDesc("mp_mp15", "Grid", "bgdata/bg_mp15.seg"),
         new SceneDesc("mp_crad", "Pipes", "bgdata/bg_crad.seg"),
         new SceneDesc("mp_arec", "Ravine", "bgdata/bg_arec.seg"),
         new SceneDesc("mp_mp9", "Ruins", "bgdata/bg_mp9.seg"),
         new SceneDesc("mp_mp10", "Sewers", "bgdata/bg_mp10.seg"),
         new SceneDesc("mp_oat", "Skedar", "bgdata/bg_oat.seg"),
         new SceneDesc("mp_mp13", "Villa", "bgdata/bg_mp13.seg"),
         new SceneDesc("mp_mp4", "Warehouse", "bgdata/bg_mp4.seg"),

        "Multiplayer - Classic",
         new SceneDesc("mp_ref", "Complex", "bgdata/bg_ref.seg"),
         new SceneDesc("mp_mp11", "Felicity", "bgdata/bg_mp11.seg"),
         new SceneDesc("mp_jun", "Temple", "bgdata/bg_jun.seg"),
    ],

    // WIP
    hidden: !IS_DEVELOPMENT,
};
