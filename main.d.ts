declare global {
    type KeysPair<T> = T extends T ? {
        [K in keyof T]: K extends string | number ? K extends string ? K : `${K}` : never
    }[keyof T] : never
    type Keys<T> = NonNullable<KeysPair<T>>[]
    interface ObjectConstructor {
        keys<T extends {}>(o: T): Keys<T>
    }
}

export {}
