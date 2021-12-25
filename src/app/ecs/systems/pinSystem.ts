import {System} from "../system";
import {World} from "../world";
import {MultiEcsStorage, SingleEcsStorage} from "../storage";
import {
    Component,
    FOLLOW_MOUSE_TYPE,
    FollowMouseComponent,
    HOST_HIDDEN_TYPE,
    HostHiddenComponent,
    POSITION_TYPE,
    PositionComponent,
    NAME_TYPE,
    NameComponent
} from "../component";
import {ElementType, GRAPHIC_TYPE, GraphicComponent, PointElement, VisibilityType} from "../../graphics";
import {POINT_RADIUS} from "./back/pixiGraphicSystem";
import {DisplayPrecedence} from "../../phase/editMap/displayPrecedence";
import {TOOL_TYPE, ToolSystem, ToolPart} from "./back/toolSystem";
import {PointerEvents, PointerUpEvent} from "./back/pixiBoardSystem";
import {SELECTION_TYPE, SelectionSystem} from "./back/selectionSystem";
import {Tool} from "../tools/toolType";
import {SpawnCommandKind} from "./command/spawnCommand";
import {executeAndLogCommand} from "./command/command";
import {findForeground, PARENT_LAYER_TYPE, ParentLayerComponent} from "./back/layerSystem";
import { NameAsLabelComponent, NAME_AS_LABEL_TYPE } from "./back/nameAsLabelSystem";
import SafeEventEmitter from "../../util/safeEventEmitter";
import { CreationInfoResource, CREATION_INFO_TYPE, Resource } from "../resource";

export const PIN_TYPE = 'pin';
export type PIN_TYPE = typeof PIN_TYPE;

export interface PinComponent extends Component {
    type: PIN_TYPE;
    color: number;
    size?: number;
}

export const DEFAULT_SIZE: number = 1;

export interface PinResource extends Resource {
    type: PIN_TYPE;
    defaultSize: number;
}


export class PinSystem implements System {
    readonly name = PIN_TYPE;
    readonly dependencies = [TOOL_TYPE, GRAPHIC_TYPE, SELECTION_TYPE, NAME_AS_LABEL_TYPE];

    readonly world: World;
    readonly selectionSys: SelectionSystem;

    readonly storage = new SingleEcsStorage<PinComponent>(PIN_TYPE, true, true);

    res: PinResource;

    constructor(world: World) {
        this.world = world;

        this.selectionSys = this.world.systems.get(SELECTION_TYPE) as SelectionSystem;

        if (world.isMaster) {
            let toolSys = world.systems.get(TOOL_TYPE) as ToolSystem;
            toolSys.addToolPart(new CreatePinToolPart(this));
            toolSys.addTool(Tool.CREATE_PIN, ['space_pan', 'create_pin', 'creation_flag']);
        }

        world.addResource({
            type: PIN_TYPE,
            defaultSize: DEFAULT_SIZE,
        } as PinResource, 'ignore');
        this.res = world.getResource(PIN_TYPE)!! as PinResource;

        world.addStorage(this.storage);
        world.events.on('component_add', this.onComponentAdd, this);
        world.events.on('component_edited', this.onComponentEdited, this);
        world.events.on('resource_edited', this.onResourceEdited, this);
    }

    private onComponentAdd(c: Component): void {
        if (c.type !== PIN_TYPE) return;
        let pin = c as PinComponent;
        let pos = this.world.getComponent(c.entity, POSITION_TYPE) as PositionComponent;
        if (pos === undefined) return;

        let display = this.world.getComponent(c.entity, GRAPHIC_TYPE) as GraphicComponent;
        if (display === undefined) {
            display = {
                type: GRAPHIC_TYPE,
                entity: -1,
                interactive: true,
                display: this.createElement()
            } as GraphicComponent;
            this.world.addComponent(c.entity, display);
        }

        this.world.addComponent(c.entity, {
            type: NAME_AS_LABEL_TYPE,
            initialOffset: {x: 0, y: -POINT_RADIUS},
        } as NameAsLabelComponent);

        this.redrawComponent(pin, display.display as PointElement);

        // In some older versions there was a label field that was printed on top of the point,
        // this has been removed in favour of the "name" components (and the 'name_as_label' system)
        // so if you find a label that is not listed in the names add it to keep compatibility
        if ((pin as any).label !== undefined) {
            const label = (pin as any).label;
            let isNameFound = false;
            for (let name of (this.world.storages.get(NAME_TYPE) as MultiEcsStorage<NameComponent>).getComponents(pin.entity)) {
                if (name === label) {
                    isNameFound = true;
                    break;
                }
            }

            if (!isNameFound) {
                this.world.addComponent(pin.entity, {
                    type: NAME_TYPE,
                    name: label,
                } as NameComponent);
            }

            delete (pin as any).label;
        }
    }

    private onComponentEdited(comp: Component, changed: any): void {
        if (comp.type === PIN_TYPE) {
            let pin = comp as PinComponent;

            let grapc = this.world.getComponent(comp.entity, GRAPHIC_TYPE) as GraphicComponent;
            let pinDisplay = grapc.display as PointElement;
            this.redrawComponent(pin, pinDisplay);
        }
    }

    private onResourceEdited(res: Resource, changed: any): void {
        if (res.type === PIN_TYPE) {
            for (let c of this.storage.getComponents()) {
                if (c.size !== undefined && c.size !== 0) continue;
                let gc = this.world.getComponent(c.entity, GRAPHIC_TYPE) as GraphicComponent;
                this.redrawComponent(c, gc.display as PointElement);
            }
        }
    }

    createElement(): PointElement {
        return {
            type: ElementType.POINT,
            priority: DisplayPrecedence.PINS,
            visib: VisibilityType.NORMAL,
            ignore: false,
            interactive: true,
            color: 0xFFFFFF,
            scale: 1,
            children: [],
        } as PointElement;
    }

    private redrawComponent(pin: PinComponent, display: PointElement): void {
        display.color = pin.color;
        display.scale = pin.size || this.res.defaultSize;

        this.world.editComponent(pin.entity, GRAPHIC_TYPE, { display }, undefined, false);

        this.world.editComponent(pin.entity, NAME_AS_LABEL_TYPE, {
            initialOffset: {x: 0, y: -POINT_RADIUS * display.scale},
        } as NameAsLabelComponent);
    }

    enable() {
    }

    destroy(): void {
    }
}

export class CreatePinToolPart implements ToolPart {
    readonly name = Tool.CREATE_PIN;
    private readonly sys: PinSystem;

    // Entity of the pin to be created (or -1)
    createPin: number = -1;

    constructor(sys: PinSystem) {
        this.sys = sys;
    }

    initCreation() {
        this.cancelCreation();
        let color = Math.floor(Math.random() * 0xFFFFFF);

        let display = this.sys.createElement();
        display.color = color;
        display.visib = VisibilityType.ALWAYS_VISIBLE;
        display.scale = this.sys.res.defaultSize;

        this.createPin = this.sys.world.spawnEntity(
            {
                type: HOST_HIDDEN_TYPE,
            } as HostHiddenComponent,
            {
                type: POSITION_TYPE,
                entity: -1,
                x: Number.NEGATIVE_INFINITY,
                y: Number.NEGATIVE_INFINITY,
            } as PositionComponent,
            {
                type: GRAPHIC_TYPE,
                entity: -1,
                interactive: false,
                display,
            } as GraphicComponent,
            {
                type: FOLLOW_MOUSE_TYPE,
            } as FollowMouseComponent,
        );
    }

    cancelCreation() {
        if (this.createPin !== -1) {
            this.sys.world.despawnEntity(this.createPin);
            this.createPin = -1;
        }
    }

    confirmCreation() {
        if (this.createPin === -1) return;

        const world = this.sys.world;
        let id = this.createPin;
        let g = world.getComponent(id, GRAPHIC_TYPE) as GraphicComponent;
        let loc = world.getComponent(id, POSITION_TYPE) as PositionComponent;
        world.despawnEntity(id);

        const cmd = SpawnCommandKind.from(world, [
            {
                type: POSITION_TYPE,
                x: loc.x,
                y: loc.y,
            } as PositionComponent,
            {
                type: PIN_TYPE,
                color: (g.display as PointElement).color,
            } as PinComponent,
            {
                type: PARENT_LAYER_TYPE,
                layer: findForeground(this.sys.world),
            } as ParentLayerComponent,
        ]);

        this.createPin = -1;
        const creationInfo = this.sys.world.getResource(CREATION_INFO_TYPE) as CreationInfoResource | undefined;
        if (creationInfo?.exitAfterCreation ?? true) {
            this.sys.world.editResource(TOOL_TYPE, {
                tool: Tool.INSPECT,
            });
        } else {
            this.initCreation();
        }
        executeAndLogCommand(world, cmd);
    }


    onEnable(): void {
        this.initCreation();
    }

    onDisable(): void {
        this.cancelCreation();
    }

    onPointerUp(event: PointerUpEvent) {
        if (event.isInside) {
            this.confirmCreation();
        }
    }

    onResourceEdited(res: Resource) {
        if (res.type == PIN_TYPE && this.createPin !== -1) {
            const comp = this.sys.world.getComponent(this.createPin, GRAPHIC_TYPE) as GraphicComponent;
            (comp.display as PointElement).scale = (res as PinResource).defaultSize;
            this.sys.world.editComponent(this.createPin, GRAPHIC_TYPE, { display: comp.display }, undefined, false);
        }
    }

    initialize(events: SafeEventEmitter): void {
        events.on(PointerEvents.POINTER_UP, this.onPointerUp, this);
        events.on('resource_edited', this.onResourceEdited, this);
    }

    destroy(): void {
    }
}