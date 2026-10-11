export declare const SPAWN_URL: string;
export declare const SPAWN_SIZES: number[];
export declare function checkSpawn(bytes: Uint8Array): true;
export declare function fetchSpawn(dest: string, url?: string): Promise<string>;
