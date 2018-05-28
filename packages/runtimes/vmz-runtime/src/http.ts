// @ts-nocheck
/** Compile-time HTTP decorators — erased from server JS emit; kept for authoring. */
export function Get(path) {
    return function GetDecorator(_target, _key, descriptor) {
        return descriptor;
    };
}

export function Post(path) {
    return function PostDecorator(_target, _key, descriptor) {
        return descriptor;
    };
}

export function Put(path) {
    return function PutDecorator(_target, _key, descriptor) {
        return descriptor;
    };
}

export function Delete(path) {
    return function DeleteDecorator(_target, _key, descriptor) {
        return descriptor;
    };
}

export function Patch(path) {
    return function PatchDecorator(_target, _key, descriptor) {
        return descriptor;
    };
}
