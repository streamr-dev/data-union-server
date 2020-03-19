const { utils: { getAddress, BigNumber: BN }} = require("ethers")

module.exports = class MonoplasmaMember {
    constructor(name, address, earnings, active = true) {
        this.name = name || ""
        this.address = getAddress(address)
        this.earnings = earnings ? new BN(earnings) : new BN(0)
        this.active = !!active
    }

    addRevenue(amount) {
        this.earnings = this.earnings.add(new BN(amount))
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
