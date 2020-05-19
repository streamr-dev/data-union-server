import {getAddress, BigNumber } from 'ethers/utils'

export class MonoplasmaMember {
    private name : String;
    private address : String;
    private earnings : BigNumber;
    private active : boolean;
    constructor(name, address, earnings, active = true) {
        this.name = name || ""
        this.address = getAddress(address)
        this.earnings = earnings ? new BigNumber(earnings) : new BigNumber(0)
        this.active = !!active
    }

    addRevenue(amount) {
        this.earnings = this.earnings.add(new BigNumber(amount))
    }

    isActive() {
        return !!this.active
    }

    /**
     * @param {boolean} activeState true if active, false if not going to be getting revenues
     */
    setActive(activeState) {
        this.active = !!activeState
    }

    toObject() {
        const obj = {
            address: this.address,
            earnings: this.earnings.toString(),
            active: !!this.active
        }
        if (this.name) {
            obj.name = this.name
        }
        return obj
    }

    clone() {
        return this.constructor.fromObject(this.toObject())
    }

    static fromObject(obj) {
        return new MonoplasmaMember(obj.name, obj.address, obj.earnings, obj.active)
    }
}
