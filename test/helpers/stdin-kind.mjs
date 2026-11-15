// Node source for a child to classify its stdin (#1682): defines `kind` as file, fifo, socket, char or other.
// The child must have `fs` in scope.
export const kindOfStdin="const s=fs.fstatSync(0),kind=s.isFile()?'file':s.isFIFO()?'fifo':s.isSocket()?'socket':s.isCharacterDevice()?'char':'other';";
