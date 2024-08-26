require("dotenv").config();

const DEBUG = true;

const config = {
    organization: "Axactor.Sweden",
    shareTree: "FileShare",
    fieldSeparator: "\t",
    lineSeparator: "\n",
    jiraAddress: process.env.VITE_JIRAURL,
    jiraToken: process.env.VITE_JIRATOKEN,
    traversableObjectTypes: [
        300, // Access Management
        301, // Intility Access Group
        427, // Access Role
        1788, // Job Role
    ],
    specialAccounts: [
        // /\.Role\./i,
        // /\.Profile\./i,
        /CREATOROWNER$/,
        /NTAUTHORITY\\SYSTEM$/,
        /acolyte/,
        /IISAPPPOOL/,
    ],

    maxSearchIterations: 100,
    maxResultsPerPage: 10,
};

const params = {
    renderCounter: 0,
    clearInputTimeout: null,
    searchResult: [],
    groupMembers: {},
    objectCache: {},
    allUsers: {},
    loading: {},
    attributeMap: {
        5479: { name: "accessGroups", type: "array" },
        9999: { name: "zzSample", type: "value" },
    },
    folderPermission: {},
    perm: {
        R: 4,
        W: 2,
        X: 1,
    },
    permissions: {},
    resolvedAccess: {},
    groupList: {},
    userList: {},
    fetchCounter: 0,
};

async function main() {
    console.log("== Starting ==");
    await searchCMDB();

    let shareIndex = 0;
    for (const folderObject of params.searchResult) {
        shareIndex++;
        const foKey = folderObject.objectKey;
        const foLabel = folderObject.label;
        console.log(`Share ${shareIndex}:`, foKey, foLabel);

        folderObject.accessGroups ??= [];
        for (const ag of folderObject.accessGroups) {
            const agKey = ag.referencedObject.objectKey;
            const agLabel = ag.referencedObject.label;
            const agPerm = getPermissionFromName(agLabel);
            params.permissions[agKey] = agPerm;
            console.log(" -- ", agKey, ":", agLabel);

            const members = await getGroupMembers(
                ag.referencedObject.objectKey,
                1 // IndentCount
            );

            Object.entries(members).map((m) => {
                const mKey = m[0];
                const mLabel = m[1].name;
                params.resolvedAccess[foKey] ??= {
                    objectKey: foKey,
                    label: foLabel,
                    members: {},
                };
                params.resolvedAccess[foKey].members[mKey] ??= {
                    level: 0,
                };
                params.resolvedAccess[foKey].members[mKey].level |= agPerm;
                // Delete: flags &= ~LEVEL
                // Add:    flags |= LEVEL
                // Toggle: flags ^= LEVEL
            });
        }
    }

    // Draw access matrix
    // Header
    let header = ["Key", "Folder"];
    for (const ul of Object.entries(params.userList)) {
        const uKey = ul[0];
        // console.log("UL", ul);
        const uLabel = ul[1].name;
        header.push(uLabel);
    }
    header = header.join(config.fieldSeparator);

    // Body
    let bodyLines = [header];
    for (const access of Object.entries(params.resolvedAccess)) {
        const foKey = access[0];
        const foMap = access[1];
        // console.log("FOMAP", foMap);
        let body = [foKey, foMap.label];

        for (const ul of Object.entries(params.userList)) {
            const uKey = ul[0];
            const uLabel = ul[1].label;
            const level =
                params.resolvedAccess[foKey].members[uKey]?.level ?? "";
            //const ll = params.perm.find((e) => { return e == level })
            let ll = "";
            switch (level) {
                case 1:
                    ll = "?";
                    break;
                case 2:
                    ll = "W";
                    break;
                case 4:
                    ll = "R";
                    break;
                case 6:
                    ll = "W";
                    break;
                case 7:
                    ll = "X";
                    break;
            }
            body.push(ll);
        }
        bodyLines.push(body.join(config.fieldSeparator));
    }

    const bodyString = bodyLines.join(config.lineSeparator);

    let filename = new Date().toISOString(); // '2012-11-04T14:51:06.157Z'
    filename = filename.replace(/T/, "_"); // replace T with underscore
    filename = filename.replace(/\..+/, ""); // delete the dot and everything after
    filename = config.organization + "_" + filename + ".csv";
    filename = filename.replace(/[ :-]/g, ""); // remove space, colon and minus

    const fs = require("node:fs");
    fs.writeFile(filename, bodyString, (err) => {
        if (err) {
            console.error(err);
        }
    });

    console.log(`${params.fetchCounter} fetch requests`);
    console.log(performance.now(), "ms runtime");
    console.log("== Ended ==");
}

function indent(count) {
    const text = " -- ";
    return text.repeat(count);
}

async function searchCMDB() {
    params.loading["search"] = true;
    try {
        let page = 1;
        let result = false;
        do {
            let url = config.jiraAddress + "/iql/objects";
            url += `?page=${page}`;
            url += `&resultPerPage=${config.maxResultsPerPage}`;
            url += `&iql=objectType in ("FileShare", "Sweden FileShare", "Finland FileShare", "Norway FileShare", "Germany FileShare", "Italy FileShare", "Spain FileShare")`;
            url += ` and "Ownership (Organization)" IN ("${config.organization}")`;
            console.log(`Request #${page}: `, url);
            const response = await fetch(url, {
                headers: {
                    Authorization: "Bearer " + config.jiraToken,
                },
            });
            params.fetchCounter++;
            result = await response.json();

            result.objectEntries.map((o, index) => {
                o.attributes.map((attributeEntry) => {
                    const id = attributeEntry.objectTypeAttributeId;
                    const attr = params.attributeMap[id];
                    if (attr !== undefined) {
                        const name = attr.name;
                        if (attr.type == "array") {
                            o[name] = attributeEntry.objectAttributeValues;
                        } else {
                            o[name] =
                                attributeEntry.objectAttributeValues[0]
                                    ?.displayValue ?? "n/a";
                        }
                    }
                });
                delete o.hasAvatar;
                delete o.avatar;
                delete o.objectType;
                params.searchResult.push(o);
            });

            page += 1;
        } while (
            result &&
            result.toIndex < result.totalFilterCount &&
            page < config.maxSearchIterations
        );
    } catch (err) {
        console.error("Exception", err);
    } finally {
        params.loading["search"] = false;
    }
    console.log("Size of params.searchResult:", params.searchResult.length);
}

function getPermissionFromName(folderName) {
    const reModify = /(\\Administrators|\.Direct|\.Modify)$/i;
    const reRead = /\.Read$/i;
    if (reModify.exec(folderName)) return params.perm.W;
    else if (reRead.exec(folderName)) return params.perm.R;
    else return params.perm.X;
}

async function getGroupMembers(groupObjectKey, indentCount) {
    if (DEBUG)
        console.log(
            indent(indentCount),
            "Get members of group",
            groupObjectKey
        );

    // Check if result is already cached.
    // Quick exit if result is already cached.
    if (params.groupMembers[groupObjectKey]) {
        console.log(`Cache hit on ${groupObjectKey}.`);
        return params.groupMembers[groupObjectKey];
    }

    // Set defaults
    params.groupMembers[groupObjectKey] ??= {};

    // Get the group details, and member list.
    const accessGroupObject = await getObject(groupObjectKey);
    const accessGroupMembers = accessGroupObject.attributes.find((f) => {
        return f.objectTypeAttribute.name == "Access Group Members";
    });

    // Loop over members
    if (accessGroupMembers)
        for (const memberObject of accessGroupMembers?.objectAttributeValues) {
            const member = await getMemberDetails(memberObject);
            console.log(
                `Member ${member.name} (${member.objectKey}) T:${member.traversable} S:${member.special}`
            );

            // Regular user/member
            if (!member.traversable && !member.special) {
                console.log(
                    indent(indentCount),
                    `Added member ${member.objectKey}, ${member.name}, ${member.heritage}`
                );
                params.groupMembers[groupObjectKey][member.objectKey] = member;
                params.userList[member.objectKey] ??= member;
            }

            // Group
            if (member.traversable) {
                await traverseMember(groupObjectKey, member, indentCount);
            }
        }

    return params.groupMembers[groupObjectKey];
}

async function getMemberDetails(memberObject) {
    // Make simple user object
    const member = {
        objectKey: memberObject.referencedObject.objectKey,
        name: memberObject.referencedObject.label,
        heritage: memberObject.referencedObject.objectType.name,
        url: memberObject.referencedObject._links.self,
        parentType: memberObject.referencedObject.objectType.parentObjectTypeId,
        special: false,
        traversable: false,
    };
    console.log(`Got member details for ${member.objectKey}, ${member.name}`);

    // Set special flag based on name criterias
    member.special = config.specialAccounts.some((re) => {
        return re.test(member.name);
    });

    // Set traversable if member is a group
    member.traversable = config.traversableObjectTypes.includes(
        member.parentType
    );

    return member;
}

async function traverseMember(groupObjectKey, member, indentCount = 0) {
    // return list of objectKeys
    // Insert object keys into params.groupMembers[groupObjectKey]
    let traversalCounter = 0;
    let traversedMembers = await getGroupMembers(
        member.objectKey,
        indentCount + 1
    );
    try {
        for (const tmIndex in traversedMembers) {
            const tm = traversedMembers[tmIndex];
            params.groupMembers[groupObjectKey][tm.objectKey] = tm;
            traversalCounter += 1;
        }
        console.log(
            indent(indentCount),
            "Added",
            traversalCounter,
            "members from ",
            member.objectKey,
            member.name
        );
    } catch (ex) {
        console.error("error at traverse");
        console.error("EX:", ex);
        console.error("VAL:", typeof traversedMembers, traversedMembers);
    }
}

async function getObject(objectKey) {
    if (params.objectCache[objectKey]) {
        return params.objectCache[objectKey];
    } else {
        let url = config.jiraAddress + "/object/" + objectKey;
        const response = await fetch(url, {
            headers: {
                Authorization: "Bearer " + config.jiraToken,
            },
        });
        params.fetchCounter++;
        const resultData = await response.json();
        params.objectCache[objectKey] = resultData;
        return params.objectCache[objectKey];
    }
}

// Execute
main();
