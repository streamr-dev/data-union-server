export declare class MonoplasmaMember {
    constructor(name: any, address: any, earnings: any, active?: boolean);
    addRevenue(amount: any): void;
    isActive(): boolean;
    /**
     * @param {boolean} activeState true if active, false if not going to be getting revenues
     */
    setActive(activeState: any): void;
    toObject(): {
        address: any;
        earnings: any;
        active: boolean;
    };
    clone(): any;
    static fromObject(obj: any): MonoplasmaMember;
}
