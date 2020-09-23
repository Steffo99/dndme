import {Aabb} from "../geometry/aabb";

export enum GeomertyQueryType {
    POINT, AABB,
}

export class QueryHitEvent {
    readonly type: GeomertyQueryType;
    readonly multi: boolean;
    readonly aabb: Aabb;// If it's a point minX = maxX && minY = maxY
    readonly data: PIXI.IPointData | Aabb;

    hits = new Set<number>();

    private constructor(type: GeomertyQueryType, multi: boolean, aabb: Aabb, data?: PIXI.IPointData) {
        this.type = type;
        this.multi = multi;
        this.aabb = aabb;
        this.data = data || aabb;
    }

    shouldContinue(): boolean {
        return this.multi || this.hits.size === 0;
    }

    addHit(entity: number): void {
        if (!this.shouldContinue()) return;
        this.hits.add(entity);
    }

    static queryPoint(point: PIXI.IPointData, multi: boolean): QueryHitEvent {
        return new QueryHitEvent(GeomertyQueryType.POINT, multi, new Aabb(point.x, point.y, point.x, point.y), point);
    }

    static queryAabb(aabb: Aabb, multi: boolean): QueryHitEvent {
        return new QueryHitEvent(GeomertyQueryType.AABB, multi, aabb);
    }
}

