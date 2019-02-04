/** Compile-time HTTP decorators — erased from server JS emit; kept for authoring. */

export function Get(path: string) {
    return function GetDecorator(_target: object, _key: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor {
        return descriptor;
    };
}

export function Post(path: string) {
    return function PostDecorator(_target: object, _key: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor {
        return descriptor;
    };
}

export function Put(path: string) {
    return function PutDecorator(_target: object, _key: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor {
        return descriptor;
    };
}

export function Delete(path: string) {
    return function DeleteDecorator(_target: object, _key: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor {
        return descriptor;
    };
}

export function Patch(path: string) {
    return function PatchDecorator(_target: object, _key: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor {
        return descriptor;
    };
}
