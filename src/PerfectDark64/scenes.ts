import * as RDP from "../Common/N64/RDP";
import * as UI from "../ui";
import * as Viewer from "../viewer";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { GfxBlendFactor, GfxBlendMode, GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, GfxVertexBufferFrequency, GfxWrapMode, makeTextureDescriptor2D, GfxMegaStateDescriptor } from "../gfx/platform/GfxPlatform";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph";
import { IS_DEVELOPMENT } from "../BuildVersion";
import { SceneContext } from "../SceneBase";
import { computeViewMatrix, computeViewMatrixSkybox } from '../Camera.js';
import { fillMatrix4x3, fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { hexzero0x } from "../util";
import { makeBackbufferDescSimple, makeAttachmentClearDescriptor, opaqueBlackFullClearRenderPassDescriptor, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { makeSortKey, GfxRendererLayer, GfxRenderInst, GfxRenderInstList } from "../gfx/render/GfxRenderInstManager";
import { mat4 } from "gl-matrix";
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';
import { r5g5b5a1, decodeTex_CI4, decodeTex_CI8, decodeTex_IA8, decodeTex_RGBA16, decodeTex_RGBA32, decodeTex_I8, decodeTex_I4, decodeTex_IA16, parseTLUT, TextureLUT, decodeTex_IA4, } from "../Common/N64/Image";

import { RoomBlockType, Block, BGSegment, Room} from "./bg";
import { Program } from "./shaders";
import { Vertex, GFX, Segment, Mesh, MeshBuilder, DisplayListMeshBuilder } from "./f3dex";
import { Stage, StageID, stages } from "./stages";
import * as tex from "./tex";
import { NumTextures } from "./rom";

const pathBase = `PerfectDark64/`;

interface SceneRoom {
    number: number;
    pos: Vertex; // only used for xyz

    opaque: Mesh;
    translucent: Mesh;
}

class Scene implements Viewer.SceneGfx {
    public renderHelper: GfxRenderHelper;

    private renderInstListSky = new GfxRenderInstList();
    private renderInstListMain = new GfxRenderInstList();
    private program: GfxProgram;
    private linearSampler: GfxSampler;
    private rooms: SceneRoom[];
    private skyColor = standardFullClearRenderPassDescriptor;

    private shouldRenderSkybox: boolean = true;
    private shouldRenderOpaque: boolean = true;
    private shouldRenderTranslucent: boolean = true;

    constructor(
        device: GfxDevice,
        public textureHolder: tex.TextureListHolder,
        private stage: Stage,
        seg: BGSegment,
    ) {
        this.renderHelper = new GfxRenderHelper(device);
        const cache = this.renderHelper.renderCache;

        this.skyColor = makeAttachmentClearDescriptor(stage.skyColor);
        this.rooms = this.buildSceneRooms(device, seg);
        this.program = cache.createProgram(new Program());
        this.linearSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Clamp,
            wrapT: GfxWrapMode.Clamp,
        });
    }

    private buildSceneRooms(device: GfxDevice, seg: BGSegment): SceneRoom[] {
        return seg.rooms.map(room => {
            return {
                number: room.number,
                pos: room.pos,
                opaque: this.buildBlockTree(device, room, room.opaqueRoot),
                translucent: this.buildBlockTree(device, room, room.translucentRoot),
            };
        });
    }

    private buildBlockTree(device: GfxDevice, room: Room, rootIndex: number | undefined): MeshBuilder {
        if (rootIndex === undefined) {
            return new MeshBuilder();
        }

        var builder = new DisplayListMeshBuilder();
        builder.setSegmentVertices(Segment.BGVtx, room.vertices);
        builder.setSegmentColours(Segment.BGCol, room.colours);
        let block: Block | undefined = room.blocks[rootIndex];

        while (block !== undefined) {
            block.gdls.forEach(gdl => {
                builder.processGFX(new GFX(
                    gdl.w0,
                    gdl.w1,
                ));
            });

            if (block.type === RoomBlockType.Leaf) {
                block = room.blockAtOffset(block.nextPtr);
            } else if (block.type === RoomBlockType.Parent) {
                block = room.blockAtOffset(block.childPtr);
            }
        }

        builder.build(device, this.renderHelper.renderCache);
        return builder;
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        this.renderHelper.debugDraw.beginFrame(viewerInput.camera.projectionMatrix, viewerInput.camera.viewMatrix, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        const renderInstManager = this.renderHelper.renderInstManager;
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, this.skyColor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts([{
            numSamplers: 1,
            numUniformBuffers: 1,
        }]);

        this.renderSkybox(viewerInput, template);
        this.renderSceneRooms(this.rooms, viewerInput, template);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');

        builder.pushPass(pass => {
            pass.setDebugName("Skybox");
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            const skyboxDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Skybox Depth');
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyboxDepthTargetID);
            pass.exec(passRenderer => {
                this.renderInstListSky.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });

        builder.pushPass(pass => {
            pass.setDebugName("Main");
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec(passRenderer => {
                this.renderInstListMain.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });

        this.renderHelper.renderInstManager.popTemplate();

        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);
        this.renderHelper.prepareToRender();
        builder.execute();
        this.renderInstListMain.reset();
        this.renderInstListSky.reset();
    }

    private renderSkybox(viewerInput: Viewer.ViewerRenderInput, template: GfxRenderInst): void {
        if (!this.shouldRenderSkybox) {
            return
        }

        if (this.stage.skyRoom === 0x00) {
            return;
        }

        const skyRoom = this.rooms.find(v => v.number === this.stage.skyRoom);
        if (skyRoom === undefined) {
            return;
        }

        skyRoom.opaque.isSkybox = true;
        skyRoom.translucent.isSkybox = true;

        this.renderSceneRoom(skyRoom, viewerInput, template).forEach(inst => {
            if (inst.getDrawCount() > 0) {
                this.renderInstListSky.submitRenderInst(inst);
            }
        });
    }

    private renderSceneRooms(rooms: SceneRoom[], viewerInput: Viewer.ViewerRenderInput , template: GfxRenderInst): void {
        rooms.forEach(room => {
            if (room.number === this.stage.skyRoom) {
                return;
            }

            this.renderSceneRoom(room, viewerInput, template).forEach(inst => {
                // FIXME: Some rooms are empty. Maybe cull those before rendering.
                if (inst.getDrawCount() > 0) {
                    this.renderInstListMain.submitRenderInst(inst);
                }
            });
        });
    }

    private renderSceneRoom(room: SceneRoom, viewerInput: Viewer.ViewerRenderInput , template: GfxRenderInst): GfxRenderInst[] {
        var ret: GfxRenderInst[] = [];

        if (this.shouldRenderOpaque && room.opaque.isValid()) {
            template.sortKey = makeSortKey(GfxRendererLayer.OPAQUE);
            ret.push(this.renderMesh(room.opaque, room.pos, viewerInput, template));
        }
        if (this.shouldRenderTranslucent && room.translucent.isValid()) {
            template.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);
            ret.push(this.renderMesh(room.translucent, room.pos, viewerInput, template));
        }

        return ret;
    }

    private renderMesh(
        mesh: Mesh,
        pos:Vertex,
        viewerInput: Viewer.ViewerRenderInput,
        template: GfxRenderInst,
    ): GfxRenderInst {
        const data = template.allocateUniformBufferF32(Program.ub_SceneParams, (4*4) + (3*4) );
        let offs = 0;

        if (mesh.isSkybox) {
            let skyProj = mat4.create();
            computeViewMatrixSkybox(skyProj, viewerInput.camera);
            mat4.mul(skyProj, viewerInput.camera.projectionMatrix, skyProj);
            offs += fillMatrix4x4(data, offs, skyProj);
        } else {
            offs += fillMatrix4x4(data, offs, viewerInput.camera.clipFromWorldMatrix);
        }

        let mat = mat4.create();
        mat4.translate(mat, mat, [pos.x, pos.y, pos.z]);
        offs += fillMatrix4x3(data, offs, mat);

        const renderInst = this.renderHelper.renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.program);
        renderInst.setSamplerBindings(0, [{
            gfxTexture: null,
            gfxSampler: this.linearSampler,
        }]);

        renderInst.setVertexInput(
            mesh.inputLayout,
            [{ buffer: mesh.vertexBuffer, byteOffset: 0 }],
            { buffer: mesh.indexBuffer, byteOffset: 0 },
        );

        renderInst.setDrawCount(mesh.indexCount);

        let megaStateFlags: Partial<GfxMegaStateDescriptor> = {
            cullMode: GfxCullMode.Back,
        };

        setAttachmentStateSimple(megaStateFlags, {
            blendMode: GfxBlendMode.Add,
            blendSrcFactor: GfxBlendFactor.SrcAlpha,
            blendDstFactor: GfxBlendFactor.OneMinusSrcAlpha,
        });
        renderInst.setMegaStateFlags(megaStateFlags);

        return renderInst;
    }

    public destroy(device: GfxDevice): void {
        this.rooms.forEach(room => {
            if (room.opaque !== undefined) {
                room.opaque.destroy(device);
            }
            if (room.translucent !== undefined) {
                room.translucent.destroy(device);
            }
        });

        this.renderHelper.destroy();
        this.textureHolder.destroy(device);
    }

    public createPanels(): UI.Panel[] {
        const panel = new UI.Panel();
        panel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        panel.setTitle(UI.RENDER_HACKS_ICON, 'Render Settings');

        const renderSkyboxCheckbox = new UI.Checkbox('Render skybox ', this.shouldRenderSkybox);
        renderSkyboxCheckbox.onchanged = () => {
            this.shouldRenderSkybox = renderSkyboxCheckbox.checked;
        };
        panel.contents.appendChild(renderSkyboxCheckbox.elem);

        const renderOpaqueCheckbox = new UI.Checkbox('Render opaque blocks', this.shouldRenderOpaque);
        renderOpaqueCheckbox.onchanged = () => {
            this.shouldRenderOpaque = renderOpaqueCheckbox.checked;
        };
        panel.contents.appendChild(renderOpaqueCheckbox.elem);

        const renderTranslucentCheckbox = new UI.Checkbox('Render translucent blocks', this.shouldRenderTranslucent);
        renderTranslucentCheckbox.onchanged = () => {
            this.shouldRenderTranslucent = renderTranslucentCheckbox.checked;
        };
        panel.contents.appendChild(renderTranslucentCheckbox.elem);

        return [panel];
    }
}

class SceneDesc implements Viewer.SceneDesc {
    constructor(
        public id: string,
        public stageID: StageID,
        public name: string,
    ) {
    }

    public async createScene(device: GfxDevice, sceneContext: SceneContext): Promise<Viewer.SceneGfx> {
        const stage: Stage|undefined = stages.find(v => v.id === this.stageID);
        if (stage === undefined) {
            throw new Error(`StageID ${hexzero0x(this.stageID, 2)} not found`);
        }

        const bgJSON = sceneContext.dataFetcher.fetchData([pathBase, stage.bgPath, ".json"].join(""));
        const viewerTextures = await loadViewerTextures(sceneContext, device);
        const textureHolder = new tex.TextureListHolder(viewerTextures);

        return new Scene(device, textureHolder, stage, BGSegment.fromJSON(await bgJSON));
    }
}

async function loadViewerTextures(sceneContext: SceneContext, device: GfxDevice): Promise<Viewer.Texture[]> {
    const binPromise = sceneContext.dataFetcher.fetchData(pathBase + "textures.bin");
    const metaJSON = await sceneContext.dataFetcher.fetchData(pathBase + "textures.json");
    const meta = JSON.parse(new TextDecoder().decode(metaJSON.arrayBuffer)) as tex.InflatedTexture[];
    const bin = await binPromise;

    return meta.map(texture => {
        let lut = new Uint8Array(4 * texture.palette.length);
        texture.palette.forEach((v, i) => {
            r5g5b5a1(lut, i * 4, v);
        });

        const dst = new Uint8Array(texture.width * texture.height * 4);

        const indices = bin.subarray(texture.offset, texture.size);
        const view = tex.preprocess(texture, indices).createDataView();

        switch (texture.format) {
        case tex.Format.RGBA16_CI8:
            decodeTex_CI8(dst, view, 0, texture.width, texture.height, lut);
            break;
        case tex.Format.RGBA16_CI4:
            decodeTex_CI4(dst, view, 0, texture.width, texture.height, lut);
            break;
        }

        const gfxTexture = device.createTexture(makeTextureDescriptor2D(
            GfxFormat.U8_RGBA_NORM,
            texture.width, texture.height,
            1,
        ));
        device.setResourceName(gfxTexture, hexzero0x(texture.index, 4));
        device.uploadTextureData(gfxTexture, 0, [dst]);

        return {gfxTexture};
    });
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
        new SceneDesc("mission_01_01", StageID.Defection, "dataDyne Central - Defection"),
        new SceneDesc("mission_01_02", StageID.Investigation, "dataDyne Research - Investigation"),
        new SceneDesc("mission_01_03", StageID.Extraction, "dataDyne Central - Extraction"),
        "Mission 2",
        new SceneDesc("mission_02_01", StageID.Villa, "Carrington Villa - Hostage One"),
        "Mission 3",
        new SceneDesc("mission_03_01", StageID.Chicago, "Chicago - Stealth"),
        new SceneDesc("mission_03_02", StageID.G5Building, "G5 Building - Reconnaissance"),
        "Mission 4",
        new SceneDesc("mission_04_01", StageID.Infiltration, "Area 51 - Infiltration"),
        new SceneDesc("mission_04_02", StageID.Rescue, "Area 51 - Rescue"),
        new SceneDesc("mission_04_03", StageID.Escape, "Area 51 - Escape"),
        "Mission 5",
        new SceneDesc("mission_05_01", StageID.AirBase, "Air Base - Espionage"),
        new SceneDesc("mission_05_02", StageID.AirForceOne, "Air Force One - Antiterrorism"),
        new SceneDesc("mission_05_03", StageID.CrashSite, "Crash Site - Confrontation"),
        "Mission 6",
        new SceneDesc("mission_06_01", StageID.Pelagic, "Pelagic II - Exploration"),
        new SceneDesc("mission_06_02", StageID.DeepSea, "Deep Sea - Nullify Threat"),
        "Mission 7",
        new SceneDesc("mission_07_01", StageID.Defense, "Carrington Institute - Defense"),
        "Mission 8",
        new SceneDesc("mission_08_01", StageID.AttackShip, "Attack Ship - Covert Assault"),
        "Mission 9",
        new SceneDesc("mission_09_01", StageID.SkedarRuins, "Skedar Ruins - Battle Shrine"),
        "Special Assignments",
        new SceneDesc("mission_10_01", StageID.MisterBlondesRevenge, "Mr. Blonde's Revenge"),
        new SceneDesc("mission_10_02", StageID.MaianSOS, "Maian SOS"),
        new SceneDesc("mission_10_03", StageID.War, "WAR!"),
        new SceneDesc("mission_10_04", StageID.Duel, "The Duel"),

        "Multiplayer - Dark",
         new SceneDesc("mp_mp3",  StageID.MPArea52, "Area 52"),
         new SceneDesc("mp_mp1",  StageID.MPBase, "Base"),
         new SceneDesc("mp_mp5",  StageID.MPCarPark, "Car Park"),
         new SceneDesc("mp_mp12", StageID.MPFortress, "Fortress"),
         new SceneDesc("mp_cryp", StageID.MPG5Building, "G5 Building"),
         new SceneDesc("mp_mp15", StageID.MPGrid, "Grid"),
         new SceneDesc("mp_crad", StageID.MPPipes, "Pipes"),
         new SceneDesc("mp_arec", StageID.MPRavine, "Ravine"),
         new SceneDesc("mp_mp9",  StageID.MPRuins, "Ruins"),
         new SceneDesc("mp_mp10", StageID.MPSewers, "Sewers"),
         new SceneDesc("mp_oat",  StageID.MPSkedar, "Skedar"),
         new SceneDesc("mp_mp13", StageID.MPVilla, "Villa"),
         new SceneDesc("mp_mp4",  StageID.MPWarehouse, "Warehouse"),

        "Multiplayer - Classic",
        new SceneDesc("mp_ref",  StageID.MPComplex,  "Complex"),
        new SceneDesc("mp_mp11", StageID.MPFelicity, "Felicity"),
        new SceneDesc("mp_jun",  StageID.MPTemple,   "Temple"),
    ],

    // WIP
    hidden: !IS_DEVELOPMENT,
};
