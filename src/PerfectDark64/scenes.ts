import * as UI from "../ui";
import * as Viewer from "../viewer";
import { FakeTextureHolder, TextureHolder } from "../TextureHolder";
import { GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, GfxVertexBufferFrequency, GfxWrapMode, makeTextureDescriptor2D } from "../gfx/platform/GfxPlatform";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph";
import { IS_DEVELOPMENT } from "../BuildVersion";
import { SceneContext } from "../SceneBase";
import { fillMatrix4x3, fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { makeBackbufferDescSimple, makeAttachmentClearDescriptor, opaqueBlackFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { makeSortKey, GfxRendererLayer, GfxRenderInst, GfxRenderInstList } from "../gfx/render/GfxRenderInstManager";
import { mat4 } from "gl-matrix";

import ROM from "./rom";
import { BGSegment} from "./bg";
import { Program } from "./shaders";
import { Vertex, GFX, Segment, Mesh, MeshBuilder, DisplayListMeshBuilder } from "./f3dex";

const pathBase = `PerfectDark64`;

interface SceneRoom {
    number: number;
    pos: Vertex; // only used for xyz

    opaque: Mesh;
    translucent: Mesh;
}

class Scene implements Viewer.SceneGfx {
    public renderHelper: GfxRenderHelper;

    private renderInstList = new GfxRenderInstList();
    private program: GfxProgram;
    private linearSampler: GfxSampler;
    private rooms: SceneRoom[];

    private renderOpaque: boolean = true;
    private renderTranslucent: boolean = true;

    constructor(
        device: GfxDevice,
        public textureHolder: TextureHolder,
        seg: BGSegment,
    ) {
        this.renderHelper = new GfxRenderHelper(device);
        const cache = this.renderHelper.renderCache;

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

    public buildSceneRooms(device: GfxDevice, seg: BGSegment): SceneRoom[] {
        return seg.rooms.map(room => {
            var builder = new DisplayListMeshBuilder();
            builder.setSegmentVertices(Segment.BGVtx, room.vertices);
            builder.setSegmentColours(Segment.BGCol, room.colours);

            room.blocks.forEach(block => {
                block.gdls.forEach(gdl => {
                    builder.processGFX(new GFX(
                        gdl.w0,
                        gdl.w1,
                    ));
                });
            });

            builder.build(device, this.renderHelper.renderCache);

            return {
                number: room.number,
                pos: room.pos,
                opaque: builder,
                translucent: new Mesh(),
            };
        });
    }

    public render(device: GfxDevice, viewerInput: Viewer.ViewerRenderInput): void {
        this.renderHelper.debugDraw.beginFrame(viewerInput.camera.projectionMatrix, viewerInput.camera.viewMatrix, viewerInput.backbufferWidth, viewerInput.backbufferHeight);

        const renderInstManager = this.renderHelper.renderInstManager;
        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, opaqueBlackFullClearRenderPassDescriptor);
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const template = this.renderHelper.pushTemplateRenderInst();
        template.setBindingLayouts([{
            numSamplers: 1,
            numUniformBuffers: 1,
        }]);

        this.renderSceneRooms(this.rooms, viewerInput, template);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass(pass => {
            pass.setDebugName("Main");
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec(passRenderer => {
                this.renderInstList.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        this.renderHelper.renderInstManager.popTemplate();

        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);
        this.renderHelper.prepareToRender();
        builder.execute();
        this.renderInstList.reset();
    }

    public renderSceneRooms(rooms: SceneRoom[], viewerInput: Viewer.ViewerRenderInput , template: GfxRenderInst): void {
        rooms.forEach(room => this.renderSceneRoom(room, viewerInput, template));
    }

    public renderSceneRoom(room: SceneRoom, viewerInput: Viewer.ViewerRenderInput , template: GfxRenderInst): void {
        if (this.renderOpaque && room.opaque.isValid()) {
            this.renderMesh(room.opaque, room.pos, viewerInput, template);
        }
        if (this.renderTranslucent && room.translucent.isValid()) {
            this.renderMesh(room.translucent, room.pos, viewerInput, template);
        }
    }

    public renderMesh(mesh: Mesh, pos:Vertex, viewerInput: Viewer.ViewerRenderInput , template: GfxRenderInst): void {
        const data = template.allocateUniformBufferF32(Program.ub_SceneParams, (4*4) + (3*4) );
        let offs = 0;
        offs += fillMatrix4x4(data, offs, viewerInput.camera.clipFromWorldMatrix);

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
        renderInst.setMegaStateFlags({ cullMode: GfxCullMode.Back });
        this.renderInstList.submitRenderInst(renderInst);
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

        const renderOpaqueCheckbox = new UI.Checkbox('Render opaque blocks', this.renderOpaque);
        renderOpaqueCheckbox.onchanged = () => {
            this.renderOpaque = renderOpaqueCheckbox.checked;
        };
        panel.contents.appendChild(renderOpaqueCheckbox.elem);

        const renderTranslucentCheckbox = new UI.Checkbox('Render translucent blocks', this.renderTranslucent);
        renderTranslucentCheckbox.onchanged = () => {
            this.renderTranslucent = renderTranslucentCheckbox.checked;
        };
        panel.contents.appendChild(renderTranslucentCheckbox.elem);

        return [panel];
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

        const viewerTextures: Viewer.Texture[] = [];
        const fakeTextureHolder = new FakeTextureHolder(viewerTextures);

        return new Scene(device, fakeTextureHolder, BGSegment.fromJSON(bgJSON));
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
