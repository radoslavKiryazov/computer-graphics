// PLYParser.js was written solely for loading Gaussian splatting files.
// It therefore lacks support for general .ply features such as:
// - Any property type outside of float and uint
// - List properties
// and probably an untold number of others.
"use strict"

/**
 * @typedef {{name: String, type: String}} PlyProperty
 * @typedef {{name: String, count: number, properties: PlyProperty[], size: number, data: Uint8Array}} PlyElements
 */

/**
 * @param {String} fileName 
 * @returns {PlyElements[]}
 */
async function readPlyFile(fileName)
{
    return await fetch(fileName).then(response => response.bytes()).then(bytes => {
        let pos = 0
        const elements = []

        while(pos < bytes.length) {
            const lineStart = pos;
            while(pos < bytes.length && bytes[pos++] !== 0x0a);
            const lineEnd = pos;

            const line = new TextDecoder("ascii").decode(
                bytes.subarray(lineStart, lineEnd)
            ).trimEnd();

            const words = line.split(" ")

            if(words.length >= 3 && words[0] == "element") {
                elements.push({
                    name: words[1],
                    count: parseInt(words[2]),
                    properties: [],
                    stride: 0,
                    data: new Uint8Array(),
                })
            }

            if(words.length >= 3 && words[0] == "property") {
                elements[elements.length - 1].properties.push({
                    name: words[2],
                    type: words[1],
                })
            }

            if(line == "end_header") break;
        }
        
        let data = bytes.subarray(pos);
        
        for (const element of elements) {
            for (const property of element.properties) {
                element.stride += sizeOfType(property.type)
            }
            
            let size = element.stride * element.count;
            
            element.data = data.subarray(0, size);
            data = data.subarray(size);
        }

        return elements;
    });
}

function sizeOfType(type) {
    switch(type) {
        case "float": return 4;
        case "uint": return 4;
    }
}
