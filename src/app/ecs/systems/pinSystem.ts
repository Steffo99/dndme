import PIXI from "../../PIXI";
import {System} from "../system";
import {EcsTracker} from "../ecs";
import {EditMapPhase, Tool} from "../../phase/editMap/editMapPhase";
import {DESTROY_ALL} from "../../util/pixi";
import {EditMapDisplayPrecedence} from "../../phase/editMap/displayPrecedence";
import {SingleEcsStorage} from "../storage";
import {Component, PositionComponent} from "../component";
import {app} from "../../index";
import {Point} from "../../util/geometry";
import {TextSystem} from "./textSystem";
import {GeomertyQueryType, QueryHitEvent} from "../interaction";
import {InteractionComponent, shapePoint} from "./interactionSystem";
import {PlayerVisibleComponent} from "./playerSystem";

export interface PinComponent extends Component {
    type: 'pin';
    color: number;
    label?: string;
    _display: PIXI.Sprite;
    _labelDisplay?: PIXI.Text;
    _selected?: boolean;
}


function lerpColor(a: number, b: number, t: number): number {
    let tr = ((a >> 16) & 0xFF) * (1 - t) + ((b >> 16) & 0xFF) * t;
    let tg = ((a >> 8) & 0xFF) * (1 - t) + ((b >> 8) & 0xFF) * t;
    let tb = (a & 0xFF) * (1 - t) + (b & 0xFF) * t;
    return tr << 16 | tg << 8 | tb;
}

const RADIUS = 12;

export class PinSystem implements System {
    readonly ecs: EcsTracker;
    readonly phase: EditMapPhase;

    readonly storage = new SingleEcsStorage<PinComponent>('pin', true, true);

    textSystem: TextSystem;

    displayPins: PIXI.ParticleContainer;
    displayLabels: PIXI.Container;

    layerPin: PIXI.display.Layer;

    circleTex: PIXI.Texture;

    // Sprite of the pin to be created
    createPin?: PIXI.Sprite;

    isTranslating: boolean = false;


    constructor(tracker: EcsTracker, phase: EditMapPhase) {
        this.ecs = tracker;
        this.phase = phase;

        this.textSystem = phase.textSystem;

        tracker.addStorage(this.storage);
        tracker.events.on('component_add', this.onComponentAdd, this);
        tracker.events.on('component_edited', this.onComponentEdited, this);
        tracker.events.on('component_remove', this.onComponentRemove, this);
        tracker.events.on('selection_begin', this.onSelectionBegin, this);
        tracker.events.on('selection_end', this.onSelectionEnd, this);
        if (!tracker.isMaster) {
            tracker.events.on('players_visibility_enter', this.onPlayerVisible, this);
            tracker.events.on('players_visibility_exit', this.onNotPlayerVisible, this);
        }
    }

    private onComponentAdd(c: Component): void {
        if (c.type !== 'pin') return;
        let pin = c as PinComponent;
        let pos = this.ecs.getComponent(c.entity, "position") as PositionComponent;
        if (pos === undefined) return;


        this.addPin(pos, pin);

        this.ecs.addComponent(c.entity, {
            type: "interaction",
            entity: -1,
            snapEnabled: true,
            selectPriority: EditMapDisplayPrecedence.PINS,
            shape: shapePoint(new PIXI.Point(pos.x, pos.y)),
        } as InteractionComponent);
        this.ecs.addComponent(c.entity, {
            type: "player_visible",
            entity: -1,
            _visibleBy: [],
        } as PlayerVisibleComponent);
    }

    private onComponentEdited(comp: Component, changed: any): void {
        if (comp.type !== 'pin' && comp.type !== 'position') return;

        let pin, position;
        if (comp.type === 'pin') {
            pin = comp as PinComponent;
            position = this.ecs.getComponent(comp.entity, 'position') as PositionComponent;
        } else {
            pin = this.storage.getComponent(comp.entity);
            position = comp as PositionComponent;
        }

        if (pin === undefined || position === undefined) return;

        this.redrawComponent(pin, position);
    }

    private onComponentRemove(component: Component): void {
        if (component.type !== 'pin') return;
        (component as PinComponent)._display.destroy({
           children: true,
           texture: false,
           baseTexture: false,
        });
    }

    private onSelectionBegin(entity: number): void {
        let pin = this.storage.getComponent(entity);
        if (pin === undefined) return;
        pin._selected = true;
        this.redrawComponent(pin, undefined);
    }

    private onSelectionEnd(entity: number): void {
        let pin = this.storage.getComponent(entity);
        if (pin === undefined) return;
        pin._selected = undefined;
        this.redrawComponent(pin, undefined);
    }

    private onPlayerVisible(entity: number): void {
        let pin = this.storage.getComponent(entity);
        if (pin === undefined) return;
        if (!pin._display.visible) {
            pin._display.visible = true;
            this.displayPins.addChild(pin._display);
        }
        if (pin._labelDisplay !== undefined) pin._labelDisplay.visible = true;
        this.redrawComponent(pin, undefined);
    }

    private onNotPlayerVisible(entity: number): void {
        let pin = this.storage.getComponent(entity);
        if (pin === undefined) return;
        if (pin._display.visible) {
            pin._display.visible = false;
            this.displayPins.removeChild(pin._display);
        }
        if (pin._labelDisplay !== undefined) pin._labelDisplay.visible = false;
    }


    addPin(pos: PositionComponent, p: PinComponent) {
        if (p._display === undefined) {
            let g = new PIXI.Sprite(this.circleTex);

            if (!this.ecs.isMaster) {
                g.visible = false;
            } else {
                this.displayPins.addChild(g);
            }
            p._display = g;
        }
        this.redrawComponent(p, pos);
    }

    redrawComponent(pin: PinComponent, pos: PositionComponent | undefined) {
        if (pos === undefined) {
            pos = this.ecs.getComponent(pin.entity, 'position') as PositionComponent;
        }

        let d = pin._display;

        let color = pin.color;

        if (pin._selected) {
            color = lerpColor(color, 0x7986CB, 0.3);
        }

        d.tint = color;
        d.position.set(pos.x, pos.y);

        if (pin.label === undefined) {
            if (pin._labelDisplay !== undefined) {
                pin._labelDisplay.destroy(DESTROY_ALL);
                pin._labelDisplay = undefined;
            }
        } else {
            if (pin._labelDisplay === undefined) {
                pin._labelDisplay = new PIXI.Text("");
                pin._labelDisplay.parentLayer = this.textSystem.textLayer;
                pin._labelDisplay.anchor.set(0.5, 1);
                this.displayLabels.addChild(pin._labelDisplay);
            }
            pin._labelDisplay.position.set(pos.x, pos.y - RADIUS);
            pin._labelDisplay.text = pin.label;
        }
    }

    initCreation() {
        this.cancelCreation();
        let color = Math.floor(Math.random() * 0xFFFFFF);

        this.createPin = new PIXI.Sprite(this.circleTex);
        this.createPin.tint = color;
        this.createPin.position.set(Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY);
        this.displayPins.addChild(this.createPin);
    }

    cancelCreation() {
        if (this.createPin !== undefined) {
            this.createPin.destroy({
                children: true,
                texture: false,
                baseTexture: false,
            });
            this.createPin = undefined;
        }
    }

    redrawCreation(pos: PIXI.Point) {
        if (this.createPin !== undefined) {
            this.createPin.position.set(pos.x, pos.y);
        }
    }

    confirmCreation(pos: PIXI.Point) {
        if (this.createPin === undefined) return;

        let id = this.ecs.spawnEntity(
            {
                type: 'position',
                x: pos.x,
                y: pos.y,
            } as PositionComponent,
            {
                type: 'pin',
                color: this.createPin.tint,
                _display: this.createPin,
            } as PinComponent,
        );
        this.createPin = undefined;
        this.phase.changeTool(Tool.INSPECT);
        this.phase.selection.setOnlyEntity(id);
    }

    enable() {
        this.layerPin = new PIXI.display.Layer();
        this.layerPin.zIndex = EditMapDisplayPrecedence.PINS;
        app.stage.addChild(this.layerPin);

        // TODO: unwrap ParticleContainer from Container https://github.com/pixijs/pixi-layers/issues/60
        let cnt = new PIXI.Container();
        this.displayPins = new PIXI.ParticleContainer(10000, {
            vertices: false,
            position: true,
            rotation: false,
            uvs: false,
            tint: true,
        });
        cnt.parentLayer = this.layerPin;
        this.displayLabels = new PIXI.Container();

        cnt.addChild(this.displayPins);

        this.phase.board.addChild(cnt, this.displayLabels);

        let g = new PIXI.Graphics();
        g.beginFill(0xFFFFFF);
        g.lineStyle(0);
        g.drawCircle(RADIUS, RADIUS, RADIUS);
        this.circleTex = app.renderer.generateTexture(g, PIXI.SCALE_MODES.LINEAR, 1);
        this.circleTex.defaultAnchor.set(0.5, 0.5);
    }

    destroy(): void {
        this.displayLabels.destroy(DESTROY_ALL);
        this.circleTex.destroy(true);
        this.displayPins.destroy(DESTROY_ALL);
        this.layerPin.destroy(DESTROY_ALL);
    }
}