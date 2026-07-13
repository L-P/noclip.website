import { Color, colorNewFromRGBA8, OpaqueBlack } from '../Color';

export enum StageID {
    AirBase              = 0x27,
    AirForceOne          = 0x31,
    AttackShip           = 0x34,
    CITraining           = 0x26,
    Chicago              = 0x1d,
    CrashSite            = 0x1c,
    Duel                 = 0x4f,
    DeepSea              = 0x38,
    Defection            = 0x30,
    Defense              = 0x2d,
    Escape               = 0x19,
    Extraction           = 0x22,
    G5Building           = 0x0a,
    Infiltration         = 0x2f,
    Investigation        = 0x33,
    MaianSOS             = 0x09,
    MisterBlondesRevenge = 0x37,
    Pelagic              = 0x21,
    Rescue               = 0x35,
    SkedarRuins          = 0x2a,
    Villa                = 0x2c,
    War                  = 0x16,

    MPArea52     = 0x3b,
    MPBase       = 0x39,
    MPCarPark    = 0x3d,
    MPFortress   = 0x44,
    MPG5Building = 0x20,
    MPGrid       = 0x47,
    MPPipes      = 0x29,
    MPRavine     = 0x17,
    MPRuins      = 0x41,
    MPSewers     = 0x42,
    MPSkedar     = 0x32,
    MPVilla      = 0x45,
    MPWarehouse  = 0x3c,

    MPComplex  = 0x1f,
    MPFelicity = 0x43,
    MPTemple   = 0x25,
};

export interface Stage {
    id: StageID;
    bgPath: string;
    setupPath: string;
    skyRoom: number; // roomnumber of the skybox
    skyColor: Color; // 0x00 if no skybox (there's never a room 0)
}

// Trivia: file names refer to GoldenEye levels.
export const stages: Array<Stage> = [
    {id: StageID.AirBase,              setupPath: "UsetupcaveZ", bgPath: "bgdata/bg_cave.seg", skyRoom: 0x00, skyColor: colorNewFromRGBA8(0x001040ff)},
    {id: StageID.AirForceOne,          setupPath: "UsetupritZ",  bgPath: "bgdata/bg_rit.seg",  skyRoom: 0x00, skyColor: colorNewFromRGBA8(0x001040ff)},
    {id: StageID.AttackShip,           setupPath: "UsetupleeZ",  bgPath: "bgdata/bg_lee.seg",  skyRoom: 0x71, skyColor: OpaqueBlack},
    {id: StageID.CITraining,           setupPath: "UsetupdishZ", bgPath: "bgdata/bg_dish.seg", skyRoom: 0x00, skyColor: colorNewFromRGBA8(0x65b2ffff)},
    {id: StageID.Chicago,              setupPath: "UsetuppeteZ", bgPath: "bgdata/bg_pete.seg", skyRoom: 0x00, skyColor: OpaqueBlack},
    {id: StageID.G5Building,           setupPath: "UsetupdepoZ", bgPath: "bgdata/bg_depo.seg", skyRoom: 0x00, skyColor: OpaqueBlack},
    {id: StageID.CrashSite,            setupPath: "UsetupaztZ",  bgPath: "bgdata/bg_azt.seg",  skyRoom: 0x00, skyColor: colorNewFromRGBA8(0x9b2d1eff)},
    {id: StageID.DeepSea,              setupPath: "UsetuppamZ",  bgPath: "bgdata/bg_pam.seg",  skyRoom: 0x00, skyColor: colorNewFromRGBA8(0x050000ff)},
    {id: StageID.Defection,            setupPath: "UsetupameZ",  bgPath: "bgdata/bg_ame.seg",  skyRoom: 0x01, skyColor: OpaqueBlack},
    {id: StageID.Defense,              setupPath: "UsetupimpZ",  bgPath: "bgdata/bg_dish.seg", skyRoom: 0x00, skyColor: colorNewFromRGBA8(0x65b2ffff)},
    {id: StageID.Duel,                 setupPath: "UsetupateZ",  bgPath: "bgdata/bg_dish.seg", skyRoom: 0x00, skyColor: colorNewFromRGBA8(0x65b2ffff)},
    {id: StageID.Escape,               setupPath: "UsetuptraZ",  bgPath: "bgdata/bg_lue.seg",  skyRoom: 0x0f, skyColor: OpaqueBlack},
    {id: StageID.Extraction,           setupPath: "UsetuparkZ",  bgPath: "bgdata/bg_ame.seg",  skyRoom: 0x01, skyColor: OpaqueBlack},
    {id: StageID.Infiltration,         setupPath: "UsetuplueZ",  bgPath: "bgdata/bg_lue.seg",  skyRoom: 0x0f, skyColor: OpaqueBlack},
    {id: StageID.Investigation,        setupPath: "UsetupearZ",  bgPath: "bgdata/bg_ear.seg",  skyRoom: 0x00, skyColor: OpaqueBlack},
    {id: StageID.MaianSOS,             setupPath: "UsetupsevZ",  bgPath: "bgdata/bg_lue.seg",  skyRoom: 0x0f, skyColor: OpaqueBlack},
    {id: StageID.MisterBlondesRevenge, setupPath: "UsetupwaxZ",  bgPath: "bgdata/bg_ame.seg",  skyRoom: 0x01, skyColor: OpaqueBlack},
    {id: StageID.Pelagic,              setupPath: "UsetupdamZ",  bgPath: "bgdata/bg_dam.seg",  skyRoom: 0x00, skyColor: colorNewFromRGBA8(0x2d3e60ff)},
    {id: StageID.Rescue,               setupPath: "UsetuplipZ",  bgPath: "bgdata/bg_lue.seg",  skyRoom: 0x0f, skyColor: OpaqueBlack},
    {id: StageID.SkedarRuins,          setupPath: "UsetupshoZ",  bgPath: "bgdata/bg_sho.seg",  skyRoom: 0x02, skyColor: OpaqueBlack},
    {id: StageID.Villa,                setupPath: "UsetupeldZ",  bgPath: "bgdata/bg_eld.seg",  skyRoom: 0x00, skyColor: colorNewFromRGBA8(0x46a0ffff)},
    {id: StageID.War,                  setupPath: "UsetupstatZ", bgPath: "bgdata/bg_sho.seg",  skyRoom: 0x02, skyColor: colorNewFromRGBA8(0x6565ffff)},

    // Some of those sky colors look like flags, suspicious.
    {id: StageID.MPArea52,     setupPath: "Usetupmp3Z",  bgPath: "bgdata/bg_mp3.seg",  skyRoom: 0x00, skyColor: colorNewFromRGBA8(0x000008ff)},
    {id: StageID.MPBase,       setupPath: "Usetupmp1Z",  bgPath: "bgdata/bg_mp1.seg",  skyRoom: 0x00, skyColor: colorNewFromRGBA8(0x040000ff)},
    {id: StageID.MPCarPark,    setupPath: "Usetupmp5Z",  bgPath: "bgdata/bg_mp5.seg",  skyRoom: 0x00, skyColor: OpaqueBlack},
    {id: StageID.MPFortress,   setupPath: "Usetupmp12Z", bgPath: "bgdata/bg_mp12.seg", skyRoom: 0x00, skyColor: colorNewFromRGBA8(0x000008ff)},
    {id: StageID.MPG5Building, setupPath: "UsetupcrypZ", bgPath: "bgdata/bg_cryp.seg", skyRoom: 0x00, skyColor: colorNewFromRGBA8(0x000008ff)},
    {id: StageID.MPGrid,       setupPath: "Usetupmp15Z", bgPath: "bgdata/bg_mp15.seg", skyRoom: 0x00, skyColor: colorNewFromRGBA8(0x000008ff)},
    {id: StageID.MPPipes,      setupPath: "UsetupcradZ", bgPath: "bgdata/bg_crad.seg", skyRoom: 0x00, skyColor: OpaqueBlack},
    {id: StageID.MPRavine,     setupPath: "UsetuparecZ", bgPath: "bgdata/bg_arec.seg", skyRoom: 0x00, skyColor: OpaqueBlack},
    {id: StageID.MPRuins,      setupPath: "Usetupmp9Z",  bgPath: "bgdata/bg_mp9.seg",  skyRoom: 0x00, skyColor: OpaqueBlack},
    {id: StageID.MPSewers,     setupPath: "Usetupmp10Z", bgPath: "bgdata/bg_mp10.seg", skyRoom: 0x00, skyColor: OpaqueBlack},
    {id: StageID.MPSkedar,     setupPath: "UsetupoatZ",  bgPath: "bgdata/bg_oat.seg",  skyRoom: 0x00, skyColor: OpaqueBlack},
    {id: StageID.MPVilla,      setupPath: "Usetupmp13Z", bgPath: "bgdata/bg_mp13.seg", skyRoom: 0x00, skyColor: colorNewFromRGBA8(0x8888dcff)},
    {id: StageID.MPWarehouse,  setupPath: "Usetupmp4Z",  bgPath: "bgdata/bg_mp4.seg",  skyRoom: 0x00, skyColor: colorNewFromRGBA8(0x020000ff)},

    {id: StageID.MPComplex,  setupPath: "UsetuprefZ",  bgPath: "bgdata/bg_ref.seg",  skyRoom: 0x00, skyColor: colorNewFromRGBA8(0x020000ff)},
    {id: StageID.MPFelicity, setupPath: "Usetupmp11Z", bgPath: "bgdata/bg_mp11.seg", skyRoom: 0x00, skyColor: colorNewFromRGBA8(0x040500ff)},
    {id: StageID.MPTemple,   setupPath: "UsetupjunZ",  bgPath: "bgdata/bg_jun.seg",  skyRoom: 0x00, skyColor: colorNewFromRGBA8(0x001080ff)},
];
