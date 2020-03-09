const { utils: { getAddress, BigNumber: BN }} = require("ethers")

module.exports = class MonoplasmaMember {
    constructor(name, address, earnings, active = true) {
        this.name = name || ""
        this.address = getAddress(address)
        this.earnings = earnings ? new BN(earnings) : new BN(0)
        this.active = !!active
    }

    getEarningsAsString() {
        return this.earnings.toString(10)
    }

    getEarningsAsInt() {
        return this.earnings.toNumber()
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
            earnings: this.earnings.toString(10),
            active: !!this.active
        }
        if (this.name) {
            obj.name = this.name
        }
        return obj
    }

    static fromObject(obj) {
        return new MonoplasmaMember(obj.name, obj.address, obj.earnings, obj.active)
    }

    async getProof(tree) {
        return this.earnings.gt(new BN(0)) ? await tree.getPath(this.address) : []
    }
}
