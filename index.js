const core = require('@actions/core');
const github = require('@actions/github');
const io = require('@actions/io');
const exec = require('@actions/exec');
const fs = require("fs");
const path = require("path");

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
    const version = core.getInput('version');
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
    fs.mkdirSync(`${rootDir}/BUILD`, {recursive: true});
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

    fs.writeFileSync(`${packageName}-${version}.spec`, await buildSpecFile());
    await exec.exec('rpmbuild', ['-bb', '--define', `_topdir ${rootDir}`, '--define',
        `_rpmfilename ${packageName}-${version}-${release}.${architecture}.rpm`, `${packageName}-${version}.spec`]);
    //fs.unlinkSync(`${packageName}-${version}.spec`);

    //give them the file back
    core.setOutput('file', `${rootDir}/RPMS/${packageName}-${version}-${release}.${architecture}.rpm`);
}

async function buildSpecFile() {
    const name = core.getInput('package');
    const version = core.getInput('version');
    const release = core.getInput('release');
    const license = core.getInput('license');
    const website = core.getInput('website');
    const architecture = core.getInput('architecture');
    const summary = core.getInput('summary');
    const description = core.getInput('description');
    const files = await getFileList();
    const beforeInstall = await readFile(core.getInput('before-install'));
    const beforeUninstall = await readFile(core.getInput('before-remove'));
    const afterInstall = await readFile(core.getInput('after-install'));
    const afterUninstall = await readFile(core.getInput('after-remove'));
    const beforeUpgrade = await readFile(core.getInput('before-upgrade'));
    const afterUpgrade = await readFile(core.getInput('after-upgrade'));
    const suggestedPackages = getSuggestedPackages();

    const neededFiles = [];
    files.forEach(v => neededFiles.push(v));

    return `Name:           ${name}
Version:        ${version}
Release:        ${release}%{?dist}
Summary:        ${summary}
License:        ${license}
URL:            ${website}
Source0:        %{name}-%{version}.tar.gz
BuildArch:      ${architecture}
${suggestedPackages}

%description
${description}

%global debug_package %{nil}

%prep
%setup -q

%build

%install
#for the files, we just need everything, we can just push it all without concern
rm -rf $RPM_BUILD_ROOT
mkdir $RPM_BUILD_ROOT
cp -r * $RPM_BUILD_ROOT

%clean
rm -rf $RPM_BUILD_ROOT

%files
${neededFiles.join('\n')}

%changelog

%pre
upgrade() {
    :
${beforeUpgrade}
}
_install() {
    :
${beforeInstall}
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
${afterUpgrade}
}
_install() {
    :
${afterInstall}
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
${beforeUninstall}
fi

%postun
if [ "\${1}" -eq 0 ]
then
    :
${afterUninstall}
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
    const files = core.getInput('files').split(/\r?\n/).reduce(
        (acc, line) =>
            acc
                .concat(line.split(","))
                .filter(pat => pat)
                .map(pat => pat.trim()),
        []
    );

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
    const packages = core.getInput('suggested-packages').split(/\r?\n/).reduce(
        (acc, line) =>
            acc
                .concat(line.split(','))
                .map(p => p.trim()),
        []
    );

    if (packages.length > 0) {
        return 'Suggests: ' + packages.join(' ');
    }
    return '';
}

main().catch(e => core.setFailed(e.message));
