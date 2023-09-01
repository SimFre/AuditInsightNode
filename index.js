require("dotenv").config();

const DEBUG = true;

const config = {
    jiraAddress: process.env.VITE_JIRAURL,
    jiraToken: process.env.VITE_JIRATOKEN,
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
    userList: {},
};

async function main() {
    console.log("== Starting ==");
    await searchCMDB();

    let shareIndex = 0;
    for (const folderObject of params.searchResult) {
        shareIndex++;
        const foKey = folderObject.objectKey;
        const foLabel = folderObject.label;
        if (DEBUG) console.log(`Share ${shareIndex}:`, foKey, foLabel);

        folderObject.accessGroups ??= [];
        for (const ag of folderObject.accessGroups) {
            const agKey = ag.referencedObject.objectKey;
            const agLabel = ag.referencedObject.label;
            const agPerm = getPermissionFromName(agLabel);
            params.permissions[agKey] = agPerm;
            if (DEBUG) console.log(" -- ", agKey, ":", agLabel);

            const members = await getGroupMembers(
                ag.referencedObject.objectKey
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
                // Delete: flags &= ~ISSUE_FAVORITE
                // Add:    flags |= ISSUE_FAVORITE
                // Toggle: flags ^= ISSUE_FAVORITE
            });
        }

        // console.log("Members:", gm, "\n\n");
    }
    // console.log(params.searchResult);
    // console.log(params.resolvedAccess);

    // Draw access matrix

    // Header
    let header = ["Key", "Folder"];
    for (const ul of Object.entries(params.userList)) {
        const uKey = ul[0];
        // console.log("UL", ul);
        const uLabel = ul[1].name;
        header.push(uLabel);
    }
    header = header.join(";");

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
        bodyLines.push(body.join(";"));
        // for (const members of Object.entries(foMap.members)) {
        //     const mKey = members[0];
        //     const mMap = members[1];
        // const foKey = access[0];
    }

    const bodyString = bodyLines.join("\n");
    console.log(bodyString);

    console.log("== Ended ==");
}

async function searchCMDB() {
    params.loading["search"] = true;
    // clearTimeout(params.clearInputTimeout);
    try {
        //let url = "/data.json";
        let page = 1;
        let leftToFetch = 0;
        let result = false;
        do {
            let url = config.jiraAddress + "/iql/objects";
            url += `?page=${page}`;
            url += `&resultPerPage=10`;
            url += `&iql=objectType IN ("Sweden FileShare")`;
            if (DEBUG) console.log("Request: ", url);
            const response = await fetch(url, {
                headers: {
                    Authorization: "Bearer " + config.jiraToken,
                },
            });
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
        } while (result && result.toIndex < result.totalFilterCount);
    } catch (err) {
        console.error("Exception", err);
    } finally {
        params.loading["search"] = false;
    }
}

async function getUserDetails(objectKey) {
    if (DEBUG) console.log(`Get details for ${objectKey}.`);
    params.loading[objectKey] = true;
    const user = await getObject(objectKey);
    const userdata = {
        objectKey: user.objectKey,
        label: user.label,
        type: user.objectType.name,
        link: user._links.self,
    };
    params.allUsers[objectKey] = userdata;
    return params.allUsers[objectKey];
}

function getPermissionFromName(folderName) {
    const reModify = /(\\Administrators|\.Direct|\.Modify)$/i;
    const reRead = /\.Read$/i;
    if (reModify.exec(folderName)) return params.perm.W;
    else if (reRead.exec(folderName)) return params.perm.R;
    else return params.perm.X;
}

async function getGroupMembers(groupObjectKey) {
    if (DEBUG) console.log("Get members of group", groupObjectKey);

    // Check if result is already cached.
    if (params.groupMembers[groupObjectKey])
        return params.groupMembers[groupObjectKey];

    // Set defaults
    params.groupMembers[groupObjectKey] ??= {};

    // Get the group details, and member list.
    const accessGroupObject = await getObject(groupObjectKey);
    const accessGroupMembers = accessGroupObject.attributes.find((f) => {
        return f.objectTypeAttribute.name == "Access Group Members";
    });

    accessGroupMembers.objectAttributeValues.map((userObject) => {
        // Make simple user object
        //params.groupMembers[groupObjectKey] ??= {};
        const person = {
            objectKey: userObject.referencedObject.objectKey,
            name: userObject.referencedObject.label,
            heritage: userObject.referencedObject.objectType.name,
            url: userObject.referencedObject._links.self,
        };

        // Filter away special entries
        const filters = [
            /\.Role\./i,
            /\.Profile\./i,
            /CREATOROWNER$/,
            /NTAUTHORITY\\SYSTEM$/,
            /acolyte/,
            /IISAPPPOOL/,
            /\-NormalUser$/,
        ];
        const filterTest = filters.some((re) => {
            return re.test(person.name);
        });

        if (DEBUG)
            console.log(" ---- :", person.objectKey, person.name, filterTest);
        if (!filterTest) {
            params.groupMembers[groupObjectKey][person.objectKey] = person;
            params.userList[person.objectKey] ??= person;
        }
    });

    //      // Resolve each member
    //      const members = [];
    //      accessGroupMembers.objectAttributeValues.map(async (groupMember) => {
    //          // Get details for each user
    //        const user = await getUserDetails(
    //          groupMember.referencedObject.objectKey
    //          );
    //
    //      });

    // params.groupMembers[objectKey] = members;
    return params.groupMembers[groupObjectKey];
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
        const resultData = await response.json();
        params.objectCache[objectKey] = resultData;
        return params.objectCache[objectKey];
    }
}

// Execute
main();
