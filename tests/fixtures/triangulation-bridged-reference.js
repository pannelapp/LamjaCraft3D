// Frozen v156 reference for exact triangulation regression comparisons.
function legacyTriangulateBridgedPolygonWithHoles2(outerInput, holeInputs, minimumEarCross) {
    const points = [], makeRing = (input, ccw) => {
        let loop = normalizeLoop2(input);
        const isCcw = v2.area(loop) > 0;
        if (isCcw !== ccw)
            loop = [...loop].reverse();
        let last = null;
        for (const q of loop) {
            const node = {};
            node.index = points.length;
            node.point = [q[0], q[1]];
            points.push(node.point);
            if (!last) {
                node.prev = node;
                node.next = node;
                last = node;
            }
            else {
                node.prev = last;
                node.next = last.next;
                last.next.prev = node;
                last.next = node;
                last = node;
            }
        }
        return last?.next || null;
    };
    const outer = makeRing(outerInput, true);
    if (!outer)
        return { points, triangles: [] };
    const holes = [];
    for (const h of holeInputs) {
        const ring = makeRing(h, false);
        if (ring)
            holes.push(ring);
    }
    const insertAfter = (at, node) => { node.prev = at; node.next = at.next; at.next.prev = node; at.next = node; };
    const duplicate = (src) => { const n = {}; n.index = src.index; n.point = src.point; n.prev = n; n.next = n; return n; };
    const rightmost = (start) => { let r = start, p = start.next; while (p !== start) {
        if (p.point[0] > r.point[0] + 1e-12 || (Math.abs(p.point[0] - r.point[0]) <= 1e-12 && p.point[1] < r.point[1]))
            r = p;
        p = p.next;
    } return r; };
    const bridgeHole = (holeStart) => {
        const h = rightmost(holeStart), hy = h.point[1], hx = h.point[0];
        let bestX = Infinity, bestEdge = null, p = outer;
        do {
            const a = p.point, b = p.next.point;
            if ((a[1] > hy) !== (b[1] > hy)) {
                const x = a[0] + (hy - a[1]) * (b[0] - a[0]) / (b[1] - a[1]);
                if (x >= hx - 1e-12 && x < bestX) {
                    bestX = x;
                    bestEdge = p;
                }
            }
            p = p.next;
        } while (p !== outer);
        if (!bestEdge)
            throw Error('Could not connect a face hole to its outer boundary.');
        const a = bestEdge.point, b = bestEdge.next.point;
        let bridge;
        if (v2.dist([bestX, hy], a) <= TOL.minimumEdge)
            bridge = bestEdge;
        else if (v2.dist([bestX, hy], b) <= TOL.minimumEdge)
            bridge = bestEdge.next;
        else {
            bridge = {};
            bridge.index = points.length;
            bridge.point = [bestX, hy];
            points.push(bridge.point);
            insertAfter(bestEdge, bridge);
        }
        const bridgeCopy = duplicate(bridge), holeCopy = duplicate(h), afterBridge = bridge.next, holePrev = h.prev;
        bridge.next = h;
        h.prev = bridge;
        holePrev.next = holeCopy;
        holeCopy.prev = holePrev;
        holeCopy.next = bridgeCopy;
        bridgeCopy.prev = holeCopy;
        bridgeCopy.next = afterBridge;
        afterBridge.prev = bridgeCopy;
    };
    holes.sort((a, b) => rightmost(b).point[0] - rightmost(a).point[0]);
    for (const h of holes)
        bridgeHole(h);
    const same = (a, b) => v2.dist(a, b) <= TOL.minimumEdge;
    const remove = (n) => { n.next.prev = n.prev; n.prev.next = n.next; };
    const filter = (start) => { let p = start, again = true; while (again) {
        again = false;
        p = start;
        do {
            if (p.next !== p && same(p.point, p.next.point)) {
                if (p === start)
                    start = p.next;
                remove(p);
                again = true;
                break;
            }
            p = p.next;
        } while (p !== start);
    } return start; };
    let start = filter(outer), count = 0, p = start;
    do {
        count++;
        p = p.next;
    } while (p !== start);
    const triangles = [];
    const pointInTriangle = (q, a, b, c) => { const ab = v2.cross(a, b, q), bc = v2.cross(b, c, q), ca = v2.cross(c, a, q); return ab >= -1e-12 && bc >= -1e-12 && ca >= -1e-12; };
    const isEar = (n) => {
        const a = n.prev.point, b = n.point, c = n.next.point;
        if (v2.cross(a, b, c) <= minimumEarCross)
            return false;
        let q = n.next.next;
        while (q !== n.prev) {
            if (q !== n && q !== n.prev && q !== n.next && !same(q.point, a) && !same(q.point, b) && !same(q.point, c) && pointInTriangle(q.point, a, b, c)) {
                const reflex = v2.cross(q.prev.point, q.point, q.next.point) <= 1e-12;
                if (reflex)
                    return false;
            }
            q = q.next;
        }
        return true;
    };
    let ear = start, guard = 0, stalls = 0;
    while (count > 3 && guard++ < count * count * 8 + 10000) {
        if (isEar(ear)) {
            triangles.push([ear.prev.index, ear.index, ear.next.index]);
            const next = ear.next;
            remove(ear);
            ear = next;
            count--;
            stalls = 0;
            continue;
        }
        ear = ear.next;
        stalls++;
        if (stalls > count) {
            // Weakly-simple hole bridges duplicate their endpoints. If clipping stalls,
            // remove only a geometrically redundant collinear node; never alter the face boundary.
            let removed = false, q = ear;
            do {
                if (Math.abs(v2.cross(q.prev.point, q.point, q.next.point)) <= minimumEarCross && pointOnSegment2(q.point, q.prev.point, q.next.point, TOL.minimumEdge)) {
                    const next = q.next;
                    remove(q);
                    ear = next;
                    count--;
                    removed = true;
                    break;
                }
                q = q.next;
            } while (q !== ear);
            if (!removed)
                throw Error('Could not triangulate the face with holes.');
            stalls = 0;
        }
    }
    if (count !== 3)
        throw Error('Could not triangulate the face with holes.');
    if (Math.abs(v2.cross(ear.point, ear.next.point, ear.next.next.point)) > minimumEarCross)
        triangles.push([ear.index, ear.next.index, ear.next.next.index]);
    return { points, triangles };
}

function legacyPlanarFaceReceivingEvent(s, faceId, requested) {
    const face = s.faces.get(faceId);
    if (!face || Math.abs(requested) < SWEEP_POLICY.zeroDistance)
        return null;
    const sign = Math.sign(requested), eps = sweepShellTolerance(), lp = faceLoopPoints(s, faceId), samples = [...lp.outer, ...lp.holes.flat(), ...triangulateFaceLocal(s, faceId).map(triangleCentroid)], anchor = faceCentroid(s, faceId);
    let best = null;
    for (const other of s.faces.values()) {
        if (other.id === faceId || V.dot(other.plane.normal, face.plane.normal) > -1 + TOL.coplanarAngle * SWEEP_POLICY.parallelFaceAngleFactor)
            continue;
        const den = V.dot(other.plane.normal, face.plane.normal);
        if (Math.abs(den) < SWEEP_POLICY.receivingParallelEpsilon)
            continue;
        const t = (other.plane.offset - V.dot(other.plane.normal, anchor)) / den;
        if (Math.sign(t) !== sign || Math.abs(t) <= eps || Math.abs(t) > Math.abs(requested) + eps)
            continue;
        let inside = true;
        for (const p of samples) {
            const q = V.add(p, V.mul(face.plane.normal, t));
            if (!pointInsideFaceDomain(s, other.id, q)) {
                inside = false;
                break;
            }
        }
        if (!inside)
            continue;
        if (!best || Math.abs(t) < Math.abs(best.distance))
            best = { distance: t, targetFaceId: other.id };
    }
    return best;
}
