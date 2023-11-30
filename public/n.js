window.$n = {
    // props
    $$fileTypes: { 'n': 'n-component', 'js': 'script', 'css': 'style' }, // TODO support for CCSS-files
    $$cache: {},
    $$basePath: window.location.href.substring(0, window.location.href.lastIndexOf('/') + 1),
    get $$listeners () { return $n._listeners = $n._listeners || {};},

    // internal methods
    $listeners: e => $n.$$listeners[e] = $n.$$listeners[e] || [], // get listener for a specific event type (e)

    // methods
    on: (e, h) => h ? $n.$listeners(e).push(h) : null,
    $: type => {
        const
            e = typeof type === 'string' ? document.createElement(type) : type,
            inst = {
                element: e,
                html: value => { e.innerHTML = value ? typeof value === 'function' ? value(e.innerHTML) : value : e.innerHTML; return value ? inst : e.innerHTML }
            };
        return inst;
    },

    unwrapJS: str => str.length >= 2 && str.charAt(0) === '{' && str.charAt(str.length - 1) === '}'
        ? eval(str.substring(1, str.length - 1))
        : str,
    unwrap: str => str && str.length >= 2 && ((str.charAt(0) === '\'' && str.charAt(str.length - 1) === '\'') || (str.charAt(0) === '"' && str.charAt(str.length - 1) === '"'))
        ? str.substring(1, str.length - 1)
        : str,
    load: async urlPath => {
        urlPath = urlPath.trim();
        try{
            let data = await fetch($n.$$basePath + urlPath)
                .then(rsp => rsp.status === 200 ? rsp.text() : undefined)
                .then(content => content ? { content } : { error:  /*TODO*/'<fail>' + urlPath + '</fail>' })
                .catch(err => { console.log('ERR', urlPath, err); });// TODO handling err
            return data;
        } catch(err) { }
    },
    include: path => {
        const
            fileType = path.split('.').slice(-1)?.[0].toLowerCase() || '',
            build = data => {
                const observers = $n.$$cache[path].observers; // fetch observers into local var as we'Re handling them
                $n.$$cache[path].observers = []; // reset observers, so new can be added and the current ones won't be handled again
                observers.forEach(including => {
                    including.node = document.createElement($n.$$fileTypes[fileType]); // Note: .n-files will be be initialized via the MutationObserver, all other types directly
                    including.childs = [];
                    including.component = data;

                    if (including.component?.error || including.component?.content) {
                        including.node.innerHTML = including.component?.content || including.component?.error; // for script/style we need a new node instead of the including N-node, for n-files we need a shadow-dom-supporting new node (here n-component)

                        if (fileType === 'n') {
                            including.node.setAttribute('type', path.replace('.n', ''));
                            Array
                                .from(including.node.children)
                                .forEach(child => {
                                    including.childs.push(child);
                                    child.remove();
                                });
                            including.root = including.node.attachShadow({ mode: 'open', slotAssignment: 'manual' });
                            $n.parseCHTML(including.root, including.node.innerHTML);
                            including.node.innerHTML = '';

                            Array.from(including.includer.children).forEach(child => including.node.append(child)); // transferring childs of includer to transformed node. this is needed as otherwise manual slot-assignment won't work (slotted element must be part of DOM)
                            
                            // TODO named slot
                            // TODO support textnodes to be slottable
                            const slot = including.root.querySelector('slot');
                            if (slot) {
                                slot.assign(...including.node.children);
                            }

                            Array
                                .from(including.childs)
                                // TODO transfrom SCRIPT tags
                                .map(child => child.tagName.toLowerCase() === 'script' ? $n.$('SCRIPT').html($n.parseScript(child, including.includer)).element : child) // transform CCSS-nodes to STYLE-nodes by parsing these
                                .map(child => child.tagName.toLowerCase() === 'ccss' ? $n.$('STYLE').html($n.parseCCSS(child)).element : child) // transform CCSS-nodes to STYLE-nodes by parsing these
                                .forEach(child => including.root.append(child));
                        }
                    } else {
                        console.log('OOPS loading', path);
                    }

                    including.parent?.replaceChild(including.node, including.includer);
                });
            };
        
        if ($n.$$cache[path] && $n.$$cache[path].data) {
            build($n.$$cache[path].data); // use data from cache and build it
        } else {
            $n.load(path).then(data => build($n.$$cache[path].data = data)); // set data to cache and build it;
        }
    },
    domTraverse: (elm, init) => { // TODO currently only level 0 (body) is checked, we need recursion for deeper nested elements
        Array
            .from(elm.querySelectorAll('*'))
            .map(includer => {
                let path = includer.getAttribute('include') || /[nN](:(.*))?/.exec(includer.tagName)?.[2]?.toLowerCase() || undefined; // check for n-placeholders (<n:...>)

                if (path) {
                    path += path.indexOf('.') === -1 ? '.n' : ''; // correct placeholder name to filename
                    if (!$n.$$cache[path]) $n.$$cache[path] = { observers: [] } // set up entry in cache if not present
                    $n.$$cache[path].observers.push({ includer, parent: includer.parentNode }); // add current includer to cache observers
                }
                
                return includer;
            });
        Object
            .keys($n.$$cache)
            .forEach((cacheKey, i, arr) => {
                $n.include(cacheKey);

                if (i === arr.length - 1 && init) {
                    $n.$listeners('ready')?.forEach(l => l?.()); // broadcast to all listeners that n is ready
                    $n.$loadingStyle(false); // blend in page and remove loading styles
                    init = false;
                }
            });
    },
    convertIndentToHierarchy: (text, indentSize=4) => {
        const root = { childs: [] };
        let
            node = root,
            lastIndent = -1,
            lastNode = root;

        text?.split('\n')
            .filter(line => line && line.length > 0) // filter empty lines
            .map(line => ({ content: line.trim(), indent: line.search(/\S/) / indentSize, isProperty: /[^:&]+:[^:]+/.test(line) })) // create a helper line-object containing the line content and indentation of line
            .reduce((p, v, i, a) => { a[i - 1]?.content?.endsWith(',') ? p[p.length - 1].push(v) : p.push([v]); return p; }, []) // group line-objects that are concatinated by ','
            .map(line => ({ content: line.map(l => l.content), indent: line[0]?.indent, isProperty: line[0]?.isProperty })) // transform line groups to single line-objects
            .forEach(line => { // iterate the lines and build a hierarchy based on the indentation
                line.childs = [];

                node = line.indent > lastIndent ? lastNode : node;
                if (line.isProperty) {
                    (node.props || (node.props = []) ).push(line.content[0] || '???');
                } else {
                    if (line.indent > lastIndent) {
                        line.parent = node;
                        node = lastNode;
                    } else if (line.indent === lastIndent){
                        line.parent = node;
                    }
                    while (line.indent < lastIndent) {
                        lastIndent--;
                        node = node.parent;
                        line.parent = node;
                    }

                    node.childs.push(line);
                }

                lastIndent = line.indent;
                lastNode = line;
            });

        return root;
    },
    parseCCSS: css => {
        let cssText = '';
        const
            root = $n.convertIndentToHierarchy(css.innerText),
            traverse = (node) => {
                if (node.content) {
                    let traverser = node;
                    let ruleSet = [...node.content].map(r => r.replace(/,$/, ''));
        
                    while(traverser.parent.content) {
                        let ruleSetExt = [];
                        traverser.parent.content.map(pRule => {
                            pRule = pRule.replace(/,$/, '');
                            ruleSet.forEach(rule => ruleSetExt.push(rule.indexOf('&') === -1 ? pRule + ' ' + rule : rule.replace(/&/g, pRule)));
                        });

                        ruleSet = ruleSetExt;
                        traverser = traverser.parent;
                    }
                    if (node.props) {
                        cssText += ruleSet.join(',') + '{\n' + node.props.map(prop => '  ' + prop + ';').join('\n') + '\n}\n';
                    }
                }

                node.childs?.forEach(child => traverse(child));
            };
        traverse(root);

        return cssText;
    },
    parseScript: (node, scope) => {
        // TODO WIP, subject to change, might not work/can have bugs/not fully functional yet
        console.log('scope', scope);
        node.innerHTML.matchAll(/export (let|const)([^;]*);/g)
            .map(match => match[2]?.split(',') || [])
            .reduce((p, v) => {v.forEach(e => p.push(e)); return p;}, [])
            .map(entry => entry.trim())
            .filter(entry => entry && entry.length > 0)
            .forEach(entry => {
                let [key, value] = entry.split('=').map(v => v.trim()).filter(v => v.length > 0);
                console.log('entry', entry, key, value, scope.getAttribute(key));
            });
        return node.innerHTML.replace(/export /g, '');
    },
    parseCHTML: (root, content) => {
        if (!root || !content) return;
        let
            baseIndent = 0,
            lastIndent = 0,
            parentNode = root,
            lastNode = root;

        const parse = line => {
            let
                text = line.text.trim() + ' ', // text content to analyze (extra space is for easier 'at end'-handling)
                bracket = 0, // switch for 'inside brackets'
                sQuote = false, // switch for 'inside single quotes'
                dQuote = false, // switch for 'inside double quotes'
                firstSpaceHitted = false, // switch that the first space was hitted
                word = '', // collector, used during iteration to form words
                attributes = undefined, // object to collect attributes
                assignKey = undefined, // temporary var for assign operation
                clsOrId = 0, // 0: no current class or id, 1: class, 2: id
                tag = undefined,
                classes = [],
                id = undefined;

            const
                finalize = (tagFallback) => { // helper to finalize tags/classes/ids
                    if (word.trim().length > 0) {
                        if (clsOrId === 1) {
                            classes.push(word.trim().substring(1));
                        }
                        if (clsOrId === 2) {
                            id = word.trim().substring(1);
                        }
                        word = clsOrId === 1 || clsOrId === 2 ? '' : word;
                    }
                    if (!tag) {
                        tag = word.length > 0 ? word : tagFallback || tag;
                        word = word.length > 0 ? '' : word;
                    }
                },
                addAttribute = () => { // helper to add attributes
                    if (word.trim().length > 0) {
                        attributes[assignKey] = word.trim();
                        word = '';
                        assignKey = undefined;
                    }
                };
            Array // parsing pug-like syntax
                .from(text)
                .forEach((chr, i) => {
                    const atEnd = i === text.length - 1;

                    // TODO check comment '#'

                    if (chr === '(' && !sQuote && !dQuote) { // checking if we hit a opening bracket (it shouldn't be inside any string)
                        bracket++;
                        attributes = {};
                        finalize(); // finish any class/id/tag definition
                        chr = '';
                    }
                    if (chr === ')' && !sQuote && !dQuote) { // checking if we hit a closing bracket (it shouldn't be inside any string)
                        bracket--;
                        if (bracket === 0) {
                            addAttribute(); // finish any attribute definition
                            word = '';
                            chr = '';
                        }
                    }
                    if (chr === '"' && !sQuote && bracket > 0) { // switch the inside-single-quote flag (it shouldn't be inside any double-quote-string)
                        dQuote=!dQuote;
                    }
                    if (chr === '\'' && !dQuote && bracket > 0) { // switch the inside-double-quote flag (it shouldn't be inside any single-quote-string)
                        sQuote=!sQuote;
                    }
                    if (chr === '.' && !firstSpaceHitted && !attributes) { // set a mark that we begin a class-definition
                        finalize(); // finish any class/id/tag definition
                        clsOrId = 1;
                    }
                    if (chr === '#' && !firstSpaceHitted &&!attributes) { // set a mark that we begin an id-definition
                        finalize(); // finish any class/id/tag definition
                        clsOrId = 2;
                    }
                    if (chr === ' ') firstSpaceHitted = true;
                    if ((chr === ' ' || atEnd) && !sQuote && !dQuote) { // finalize and reset
                        finalize('section'); // finish any class/id/tag definition. here we also set a fallback as this is the last opportunity to set a tag
                        clsOrId = 0;
                    }
                    if (chr === ' ' && bracket > 0 && assignKey && !sQuote && !dQuote) { // handling finalizing assign-definition (it shouldn't be inside any string)
                        addAttribute(); // finish any attribute definition
                    }
                    if (chr === '=' && bracket > 0 && !sQuote && !dQuote) { // handling beginning assign-definition (it shouldn't be inside any string)
                        assignKey = word.trim();
                        word = '';
                        chr = '';
                    }

                    word += chr;
                })
            
            Object.assign(line, { tag, id, classes, attributes, text: word.trim() });
        };

        content
            // TODO react on comments ('#'), respect indentation to comment out nested lines
            .split('\n') // split text into lines
            .filter(line => line.trim().length > 0) // lines shouldn't be empty
            .map(line => { // form a 'line'-object with additional information about indentation
                const indent = line.search(/\S/);
                baseIndent = baseIndent === 0 || baseIndent > indent ? indent : baseIndent;

                return { indent, text: line.trim() };
            })
            .forEach(line => { // parse each line and form a definition about the upcoming html elementz
                parse(line);

                let
                    i = (line.indent - baseIndent) / 4, // form the space/tab indentation to a level-identation
                    htmlElm = document.createElement(line.tag); // create element
                if (line.text) htmlElm.innerText = line.text; // set text (if present)
                if (line.id) htmlElm.id = line.id; // assign id
                if (i > lastIndent) parentNode = lastNode; // if the current indentation is greater the last, use last element as current parent
                while (i < lastIndent) { // if the current identation is lower, reduce step by step going up the DOM for the parent(s)
                    parentNode = parentNode.parentElement || root;
                    lastIndent--;
                }
                line.classes.forEach(cls => htmlElm.classList.add(cls)); // assign all classes
                Object.keys(line.attributes || {}).forEach(key => {
                    const i = key.indexOf(':'); // parsing special attribute (<actionType>:<actionValue> = "<actionContext>")
                    if (i !== -1) {
                        const
                            actionType = key.substring(0, i).trim(),
                            actionValue = key.substring(i+1).trim(),
                            actionContext = $n.unwrapJS($n.unwrap(line.attributes[key]));

                        switch(actionType) {
                            case 'on':
                                htmlElm.addEventListener(actionValue, event => { 
                                    if (typeof actionContext === 'function') actionContext(event);
                                })
                                break;
                        }
                    } else {
                        htmlElm.setAttribute(key, $n.unwrap(line.attributes[key]));
                    }
                });

                parentNode.append(htmlElm); // add new element to current parent
                lastNode = htmlElm; // remember this element
                lastIndent = i; // remember this indentation
            });
        
        $n.domTraverse(root); // check recursivle the newly generated elements for further includes
    },
    $loadingStyle: set => {
        const delay = 100; // amount to use for the blend in effect. this comes on top for any time used to load all content
        if (set) {
            document.head.append($n._loadingStyle = $n.$('STYLE').html(`body { opacity: 0; transition: opacity ${delay}ms; }`).element); // define a temporary style for body to blend it out as long as it loads and builds elements in the background
        } else {
            const styles = document.body.style.cssText; // cache any style defined in body-tag
            document.body.style.cssText = 'opacity: 1;'; // set opacity to '1' to blend in the page as it should be ready
            setTimeout(() => { // wait for 'delay'-millisecs (the time opacity needs to blend in)
                $n._loadingStyle.remove(); // remove the temporary blend in/out class
                if (styles) { // if any former styles were set, reapply them
                    document.body.style.cssText = styles;
                } else { // otherwise just clean the temporary style from the blend in/out
                    document.body.removeAttribute('style');
                }
            }, delay);
        }
    },
};

class NComponent extends HTMLDivElement {
    constructor() {
        super();
    }
}

customElements.define("n-component", NComponent, { extends: 'div' });
$n.$loadingStyle(true);
document.addEventListener('DOMContentLoaded', e => $n.domTraverse(document.body, true)); // traverse DOM tree for n: keywords
