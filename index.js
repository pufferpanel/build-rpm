const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('fs');
const path = require('path');

async function main() {
    //several things need to happen to make this work

    //step 1 is we need a SPEC file that lists everything
    //  this step needs to do some things:
    //  - generate the "list" of files
    //  - create the pre/post scripts we need
    //  - populate the rest of the template data
    //step 2 is making a tar and moving the tar to the source folder
    //  - for this, we will use the list provided by the mapping
    //step 3 is build it

    const packageName = core.getInput('package');
    const version = core.getInput('version').replace("-", "~");
    const release = core.getInput('release');
    const architecture = core.getInput('architecture');

    const rootDir = '/tmp/rpmbuild';

    const sourceDir = `${rootDir}/SOURCES/${packageName}-${version}`;

    fs.mkdirSync(`${rootDir}/BUILD`, {recursive: true});
    fs.mkdirSync(`${rootDir}/BUILDROOT`, {recursive: true});
    fs.mkdirSync(`${rootDir}/RPMS`, {recursive: true});
    fs.mkdirSync(`${rootDir}/SOURCES`, {recursive: true});
    fs.mkdirSync(`${rootDir}/SPECS`, {recursive: true});
    fs.mkdirSync(`${rootDir}/SRPMS`, {recursive: true});
    fs.mkdirSync(sourceDir, {recursive: true});

    //move the files that are specified to the correct path
    const files = await getFileList();
    const paths = [];
    files.forEach((v, k) => {
        console.log(`Copying ${k} to ${v}`);
        //we need to create the target directory, which is the parent
        fs.mkdirSync(path.dirname(path.join(sourceDir, v.substr(1))), {recursive: true});
        paths.push([k, path.join(sourceDir, v.substr(1))]);
    });

    for (let v in paths) {
        const val = paths[v];
        await exec.exec('bash', ['-c', `cp -r ${val[0]} ${val[1]}`]);
    }

    await exec.exec('tar', ['-zcf', `${packageName}-${version}.tar.gz`, `${packageName}-${version}`], {cwd: `${rootDir}/SOURCES`});

    fs.writeFileSync(`${packageName}-${version}.spec`, await buildSpecFile(version));
    await exec.exec('rpmbuild', ['-bb', `--target=${architecture}`, '--define', `_topdir ${rootDir}`, '--define',
        `_rpmfilename ${packageName}-${version}-${release}.${architecture}.rpm`, `${packageName}-${version}.spec`]);
    //fs.unlinkSync(`${packageName}-${version}.spec`);

    //give them the file back
    core.setOutput('file', `${rootDir}/RPMS/${packageName}-${version}-${release}.${architecture}.rpm`);
}

async function buildSpecFile(version) {

    const neededFiles = [];
    (await getFileList()).forEach(v => neededFiles.push(v));

    return `Name:           ${core.getInput('package')}
Version:        ${version}
Release:        ${core.getInput('release')}%{?dist}
Summary:        ${core.getInput('summary')}
License:        ${core.getInput('license')}
URL:            ${core.getInput('website')}
Source0:        %{name}-%{version}.tar.gz
${getSuggestedPackages()}

%description
${core.getInput('description')}

%global debug_package %{nil}

%prep
%setup -q

%build

%install
export DONT_STRIP=1
#for the files, we just need everything, we can just push it all without concern
rm -rf $RPM_BUILD_ROOT
mkdir $RPM_BUILD_ROOT
cp -r * $RPM_BUILD_ROOT

%clean
rm -rf $RPM_BUILD_ROOT

%files
${neededFiles.join('\n')}

${getConfigFiles()}

%changelog

%pre
upgrade() {
    :
${await readFile(core.getInput('before-upgrade'))}
}
_install() {
    :
${await readFile(core.getInput('before-install'))}
}
if [ "\${1}" -eq 1 ]
then
    _install
elif [ "\${1}" -gt 1 ]
then
    upgrade
fi

%post
upgrade() {
    :
${await readFile(core.getInput('after-upgrade'))}
}
_install() {
    :
${await readFile(core.getInput('after-install'))}
}
if [ "\${1}" -eq 1 ]
then
    _install
elif [ "\${1}" -gt 1 ]
then
    upgrade
fi

%preun
if [ "\${1}" -eq 0 ]
then
    :
${await readFile(core.getInput('before-remove'))}
fi

%postun
if [ "\${1}" -eq 0 ]
then
    :
${await readFile(core.getInput('after-remove'))}
fi
`
}

/**
 * Parses the "files" input to be an array of files that will be included in the
 * %files spec. Key is the source file
 *
 * @returns {Promise<Map<string,string>>}
 */
async function getFileList() {
    const files = getList('files')

    const result = new Map();
    files.forEach(k => {
        const parts = k.split(':');
        result.set(parts[0], parts[1]);
    });

    return result;
}

async function readFile(file) {
    if (file && file !== '') {
        return fs.readFileSync(file).toString();
    }
    return '';
}

/**
 * Parses the "suggested-packages" input to be a list of packages that will be
 * included as the list of suggested packages
 *
 * @return {String}
 */
function getSuggestedPackages() {
    const packages = getList('suggested-packages');

    if (packages.length > 0) {
        return 'Suggests: ' + packages.join(' ');
    }
    return '';
}

function getConfigFiles() {
    const files = getList('config');

    const result = [];
    files.forEach(k => {
        let parts = k.split(':');
        if (parts.length === 1) {
            result.push('%config ' + parts[0]);
        } else {
            result.push('%config(' + parts[1] + ') ' + parts[0]);
        }
    });

    return result.join('\r\n');
}

/**
 * Get a list from the input
 *
 * @param key String
 * @returns {string[]}
 */
function getList(key) {
    return core.getInput(key).split(/\r?\n/).reduce(
        (acc, line) =>
            acc
                .concat(line.split(","))
                .filter(pat => pat)
                .map(pat => pat.trim()),
        []
    );
}

main().catch(e => core.setFailed(e.message));
