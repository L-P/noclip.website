import * as RDP from "../Common/N64/RDP";
import * as UI from "../ui";
import * as Viewer from "../viewer";
import ArrayBufferSlice from "../ArrayBufferSlice";
import { AABB } from "../Geometry";
import { GfxBlendFactor, GfxBlendMode, GfxBuffer, GfxBufferFrequencyHint, GfxBufferUsage, GfxCullMode, GfxDevice, GfxFormat, GfxInputLayout, GfxMipFilterMode, GfxProgram, GfxSampler, GfxTexFilterMode, GfxTexture, GfxVertexBufferFrequency, GfxWrapMode, makeTextureDescriptor2D, GfxMegaStateDescriptor } from "../gfx/platform/GfxPlatform";
import { GfxRenderCache } from "../gfx/render/GfxRenderCache";
import { GfxRenderHelper } from "../gfx/render/GfxRenderHelper";
import { GfxrAttachmentSlot } from "../gfx/render/GfxRenderGraph";
import { IS_DEVELOPMENT } from "../BuildVersion";
import { ImageFormat, ImageSize, r5g5b5a1, decodeTex_CI4, decodeTex_CI8, decodeTex_IA8, decodeTex_RGBA16, decodeTex_RGBA32, decodeTex_I8, decodeTex_I4, decodeTex_IA16, parseTLUT, TextureLUT, decodeTex_IA4, } from "../Common/N64/Image";
import { SceneContext } from "../SceneBase";
import { computeViewMatrix, computeViewMatrixSkybox } from '../Camera.js';
import { fillMatrix4x3, fillMatrix4x4, fillVec4 } from "../gfx/helpers/UniformBufferHelpers";
import { hexzero0x } from "../util";
import { makeBackbufferDescSimple, makeAttachmentClearDescriptor, opaqueBlackFullClearRenderPassDescriptor, standardFullClearRenderPassDescriptor } from '../gfx/helpers/RenderGraphHelpers.js';
import { makeSortKey, GfxRendererLayer, GfxRenderInst, GfxRenderInstList } from "../gfx/render/GfxRenderInstManager";
import { vec3, mat4 } from "gl-matrix";
import { setAttachmentStateSimple } from '../gfx/helpers/GfxMegaStateDescriptorHelpers';
import { drawScreenSpaceText, drawWorldSpaceText, getDebugOverlayCanvas2D } from '../DebugJunk'

import * as tex from "./tex";
import { NumTextures } from "./rom";
import { Program } from "./shaders";
import { RoomBlockType, Block, BGSegment, Room} from "./bg";
import { Stage, StageID, stages } from "./stages";
import { toReadonlyVec3, Vertex, GFX, Segment, Mesh, Interpreter } from "./f3dex";

const pathBase = `PerfectDark64/`;

class SceneRoom {
    public number: number;
    public pos: Vertex; // only used for xyz
    public bbox: AABB;
    public absoluteBBox: AABB;

    public opaque: Mesh[];
    public translucent: Mesh[];

    public constructor(props?:Partial<SceneRoom>) {
        Object.assign(this, props);

        this.name = hexzero0x(this.number, 4);
        // Room bboxes are in their own origin space, we'll need them in world space.
        this.absoluteBBox = this.bbox.clone();
        this.absoluteBBox.offset(this.absoluteBBox, toReadonlyVec3(this.pos));
    }

    // UI.Layer
    public name: string;
    public visible: boolean = true;
    public setVisible(v: boolean): void {
        this.visible = v;
    }
}

class Scene implements Viewer.SceneGfx {
    public renderHelper: GfxRenderHelper;

    private renderInstListSky = new GfxRenderInstList();
    private renderInstListMain = new GfxRenderInstList();
    private gfxProgram: GfxProgram | null = null;
    private linearSampler: GfxSampler;
    private rooms: Map<number, SceneRoom>;
    private skyColor = standardFullClearRenderPassDescriptor;

    private shouldEnableHardcodedHacks: boolean = true;
    private shouldDisplayRoomIDs: boolean = false;
    private shouldEnableTextures: boolean = true;
    private shouldEnableVertexColors: boolean = true;
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
        this.linearSampler = cache.createSampler({
            minFilter: GfxTexFilterMode.Bilinear,
            magFilter: GfxTexFilterMode.Bilinear,
            mipFilter: GfxMipFilterMode.Nearest,
            wrapS: GfxWrapMode.Repeat,
            wrapT: GfxWrapMode.Repeat,
        });
    }

    private createProgram(): Program {
        var ret = new Program();

        if (this.shouldEnableVertexColors) {
            ret.defines.set('ENABLE_VERTEX_COLORS', '1');
        }

        if (this.shouldEnableTextures) {
            ret.defines.set('ENABLE_TEXTURES', '1');
        }

        return ret;
    }

    private buildSceneRooms(device: GfxDevice, seg: BGSegment): Map<number, SceneRoom> {
        var ret: Map<number, SceneRoom> = new Map();

        seg.rooms.forEach(room => {
            ret.set(room.number, new SceneRoom({
                number: room.number,
                pos: room.pos,
                bbox: new AABB( // did not survive serialization
                    room.bbox.min[0],
                    room.bbox.min[1],
                    room.bbox.min[2],
                    room.bbox.max[0],
                    room.bbox.max[1],
                    room.bbox.max[2],
                ),
                opaque: this.buildBlockTree(device, room, room.opaqueRoot),
                translucent: this.buildBlockTree(device, room, room.translucentRoot),
            }));
        });

        return ret;
    }

    private buildBlockTree(device: GfxDevice, room: Room, rootIndex: number | undefined): Mesh[] {
        if (rootIndex === undefined) {
            return [];
        }

        var interpreter = new Interpreter(this.textureHolder);
        interpreter.setSegmentVertices(Segment.BGVtx, room.vertices);
        interpreter.setSegmentColours(Segment.BGCol, room.colours);
        let block: Block | undefined = room.blocks[rootIndex];

        while (block !== undefined) {
            block.gdls.forEach(gdl => {
                interpreter.processGFX(new GFX(
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

        return interpreter.build(device, this.renderHelper.renderCache);
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

        this.updateHarcodedHacks(viewerInput);
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

    // The original portal-based renderer doesn't make sense when you go OOB so
    // room overlaps need to be handled the hacky way.
    public updateHarcodedHacks(viewerInput: Viewer.ViewerRenderInput): void {
        let pos = vec3.create();
        pos = vec3.transformMat4(pos, vec3.create(), viewerInput.camera.worldMatrix);
        let currentRoom = 0x00;
        this.rooms.forEach(room => {
            if (room.absoluteBBox.containsPoint(pos)) {
                currentRoom = room.number;
            }
        });

        if (this.shouldDisplayRoomIDs) {
            drawScreenSpaceText( // DEBUG
                getDebugOverlayCanvas2D(),
                50, 50,
                [pos[0].toFixed(2), pos[1].toFixed(2), pos[2].toFixed(2), hexzero0x(currentRoom || 0, 2)].join(', '),
            );
        }

        if (!this.shouldEnableHardcodedHacks) {
            return;
        }

        switch(this.stage.id) {
            case StageID.Villa:
                this.updateVillaHacks(currentRoom, pos);
                break;

            case StageID.Extraction:
            case StageID.MisterBlondesRevenge:
            case StageID.Defection:
                this.updateDDTowerHacks(currentRoom, pos);
                break;

            case StageID.Defense:
            case StageID.Duel:
                this.updateInstituteHacks(currentRoom, pos);
                break;

            case StageID.Infiltration:
            case StageID.Rescue:
            case StageID.Escape:
            case StageID.MaianSOS:
                this.updateArea51Hacks(currentRoom, pos);
                break;
        }
    }

    public updateDDTowerHacks(currentRoom: number, pos: vec3): void {
        { // There one skybox for the ground floor, one for the others.
            const threshold = -4200;
            const lower = [0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14];
            const upper = [0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c];

            lower.forEach(v => this.rooms.get(v)!.setVisible(pos[1] <= threshold));
            upper.forEach(v => this.rooms.get(v)!.setVisible(pos[1] > threshold));
        }

        { // Intro buildings should not be visible unless OOB.
            const intro = [0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7];
            intro.forEach(v => {
                this.rooms.get(v)!.setVisible(
                    intro.includes(currentRoom) || currentRoom === 0x00
                );
            });
        }
    }

    public updateInstituteHacks(currentRoom: number, pos: vec3): void {
        // This place is a mess. Actually implementing portals might be quicker
        // than finding hacky workarounds.
    }

    public updateArea51Hacks(currentRoom: number, pos: vec3): void {
        // The two dissection areas overlap, it's also visible from the rooms leading up to them.
        const sectionA = [0x90, 0x91, 0x92, 0x93, 0x94, 0x99, 0x9a, 0x98, 0x96, 0x97, 0x97, 0x95];
        const sectionB = [0x80, 0x81, 0x82, 0x83, 0x84, 0x89, 0x8a, 0x88, 0x86, 0x87, 0x87, 0x85];
        if (currentRoom === 0x00 || !sectionA.concat(sectionB).includes(currentRoom)) {
            sectionA.forEach(v => this.rooms.get(v)!.setVisible(true));
            sectionB.forEach(v => this.rooms.get(v)!.setVisible(true));
            return;
        }

        let sectionAbbox = new AABB();
        let sectionBbbox = new AABB();
        sectionA.forEach(v => sectionAbbox.union(sectionAbbox, this.rooms.get(v)!.absoluteBBox));
        sectionB.forEach(v => sectionBbbox.union(sectionBbbox, this.rooms.get(v)!.absoluteBBox));

        const threshold = (sectionAbbox.max[0] + sectionBbbox.min[0]) / 2;
        sectionA.forEach(v => this.rooms.get(v)!.setVisible(pos[0] < threshold));
        sectionB.forEach(v => this.rooms.get(v)!.setVisible(pos[0] >= threshold));
    }

    public updateVillaHacks(currentRoom: number, pos: vec3): void {
        // Single floating tri above the map.
        this.rooms.get(0x58)!.setVisible(false);

        { // Generator and wind turbine rooms overlap.
            const generator = this.rooms.get(0x72)!;
            const turbine = this.rooms.get(0x61)!;
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
            const exterior = this.rooms.get(0x55)!;
            const inKitchen = [0x10, 0x11, 0x12].includes(currentRoom);
            exterior.setVisible(!inKitchen);
        }
    }

    private renderSkybox(viewerInput: Viewer.ViewerRenderInput, template: GfxRenderInst): void {
        if (!this.shouldRenderSkybox) {
            return
        }

        if (this.stage.skyRoom === 0x00) {
            return;
        }

        const skyRoom = this.rooms.get(this.stage.skyRoom);
        if (skyRoom === undefined) {
            return;
        }

        skyRoom.opaque.forEach(v => v.isSkybox = true);
        skyRoom.translucent.forEach(v => v.isSkybox = true);

        this.renderSceneRoom(skyRoom, viewerInput, template).forEach(inst => {
            if (inst.getDrawCount() > 0) {
                this.renderInstListSky.submitRenderInst(inst);
            }
        });
    }

    private renderSceneRooms(rooms: Map<number, SceneRoom>, viewerInput: Viewer.ViewerRenderInput , template: GfxRenderInst): void {
        rooms.forEach(room => {
            if (room.number === this.stage.skyRoom) {
                return;
            }

            if (!room.visible) {
                return;
            }

            if (!viewerInput.camera.frustum.contains(room.absoluteBBox)) {
                return;
            }

            if (this.shouldDisplayRoomIDs) {
                let center = vec3.create();
                room.absoluteBBox.centerPoint(center);
                drawWorldSpaceText(
                    getDebugOverlayCanvas2D(),
                    viewerInput.camera.clipFromWorldMatrix,
                    center,
                    hexzero0x(room.number, 4),
                );
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

        if (this.shouldRenderOpaque) {
            template.sortKey = makeSortKey(GfxRendererLayer.OPAQUE);
            room.opaque.forEach(mesh => {
                ret.push(this.renderMesh(mesh, room.pos, viewerInput, template));
            });
        }
        if (this.shouldRenderTranslucent) {
            template.sortKey = makeSortKey(GfxRendererLayer.TRANSLUCENT);
            room.translucent.forEach(mesh => {
                ret.push(this.renderMesh(mesh, room.pos, viewerInput, template));
            });
        }

        return ret;
    }

    private renderMesh(
        mesh: Mesh,
        pos:Vertex,
        viewerInput: Viewer.ViewerRenderInput,
        template: GfxRenderInst,
    ): GfxRenderInst {
        const data = template.allocateUniformBufferF32(Program.ub_SceneParams, (4*4) + (3*4) + 4);
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

        data[offs] = +(mesh.texture !== null);
        offs++;

        if (this.gfxProgram === null) {
            this.gfxProgram = this.renderHelper.renderCache.createProgram(this.createProgram());
        }

        const renderInst = this.renderHelper.renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setSamplerBindings(0, [{
            gfxTexture: mesh.texture,
            gfxSampler: this.linearSampler,
        }]);

        renderInst.setVertexInput(
            mesh.inputLayout,
            [{ buffer: mesh.vertexBuffer, byteOffset: 0 }],
            { buffer: mesh.indexBuffer, byteOffset: 0 },
        );

        renderInst.setDrawCount(mesh.indexCount);

        let megaStateFlags: Partial<GfxMegaStateDescriptor> = {
            cullMode: mesh.cullMode,
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
                room.opaque.forEach(v => v.destroy(device));
            }
            if (room.translucent !== undefined) {
                room.translucent.forEach(v => v.destroy(device));
            }
        });

        this.renderHelper.destroy();
        this.textureHolder.destroy(device);
    }

    public createPanels(): UI.Panel[] {
        return [
            new UI.LayerPanel(Array.from(this.rooms.values())),
            this.createRenderHacksPanel(),
        ];
    }

    private createRenderHacksPanel(): UI.Panel {
        const panel = new UI.Panel();
        panel.customHeaderBackgroundColor = UI.COOL_BLUE_COLOR;
        panel.setTitle(UI.RENDER_HACKS_ICON, 'Render Settings');

        const enableHardcodedHacks = new UI.Checkbox('Enable hardcoded room display checks', this.shouldEnableHardcodedHacks);
        enableHardcodedHacks.onchanged = () => {
            this.shouldEnableHardcodedHacks = enableHardcodedHacks.checked;
            if (!this.shouldEnableHardcodedHacks) {
                this.rooms.forEach(v => v.setVisible(true));
            }
        };
        panel.contents.appendChild(enableHardcodedHacks.elem);

        const displayRoomIDs = new UI.Checkbox('Display Room IDs', this.shouldDisplayRoomIDs);
        displayRoomIDs.onchanged = () => {
            this.shouldDisplayRoomIDs = displayRoomIDs.checked;
        };
        panel.contents.appendChild(displayRoomIDs.elem);

        const enableTexturesCheckbox = new UI.Checkbox('Enable textures', this.shouldEnableTextures);
        enableTexturesCheckbox.onchanged = () => {
            this.shouldEnableTextures = enableTexturesCheckbox.checked;
            this.gfxProgram = null;
        };
        panel.contents.appendChild(enableTexturesCheckbox.elem);

        const enableVertexColorsCheckbox = new UI.Checkbox('Enable vertex colors', this.shouldEnableVertexColors);
        enableVertexColorsCheckbox.onchanged = () => {
            this.shouldEnableVertexColors = enableVertexColorsCheckbox.checked;
            this.gfxProgram = null;
        };
        panel.contents.appendChild(enableVertexColorsCheckbox.elem);

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

        return panel;
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
        const textureHolder = await loadViewerTextures(sceneContext, device);

        return new Scene(device, textureHolder, stage, BGSegment.fromJSON(await bgJSON));
    }
}

async function loadViewerTextures(sceneContext: SceneContext, device: GfxDevice): Promise<tex.TextureListHolder> {
    const binPromise = sceneContext.dataFetcher.fetchData(pathBase + "textures.bin");
    const metaJSON = await sceneContext.dataFetcher.fetchData(pathBase + "textures.json");
    const meta = JSON.parse(new TextDecoder().decode(metaJSON.arrayBuffer)) as tex.InflatedTexture[];
    const bin = await binPromise;

    const viewerTextures = meta.map(texture => {
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

        const extraInfo: Map<string, string> = new Map();

        extraInfo.set("Number", "" + texture.index);
        extraInfo.set("Format", tex.Format[texture.format]);
        extraInfo.set("Image format", ImageFormat[texture.imageFormat]);
        extraInfo.set("Image size", ImageSize[texture.imageSize]);
        extraInfo.set("Palette size", "" + texture.palette.length);

        return { gfxTexture, extraInfo };
    });

    return new tex.TextureListHolder(viewerTextures, meta);
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
