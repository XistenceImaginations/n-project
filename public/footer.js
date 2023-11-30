class Footer {
    constructor() {
        this.elm = document.querySelector('footer');
        if (this.elm) {
            this.elm.style.margin = 'auto 200px';
        }
    }
}

new Footer();