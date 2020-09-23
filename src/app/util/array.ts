

export function arrayRemoveElem<T>(arr: T[], elem: T): void {
    let index = arr.indexOf(elem);
    if (index !== -1) arr.splice(index, 1);
}