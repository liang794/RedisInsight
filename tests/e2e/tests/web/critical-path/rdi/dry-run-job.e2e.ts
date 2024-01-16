import { t } from 'testcafe';
import { updateColumnValueInDBTable } from '../../../../helpers/database-scripts';
import { RdiInstancePage } from '../../../../pageObjects/rdi-instance-page';
import { AddNewRdiParameters, RdiApiRequests } from '../../../../helpers/api/api-rdi';

const rdiInstancePage = new RdiInstancePage();
const rdiApiRequests = new RdiApiRequests();
export const commonUrl = process.env.COMMON_URL || 'http://localhost:8080/integrate';
const rdiTable = 'rdi';
const resultMock = `{··"name":·"John",··"years":·123}`;
const outputMock = 'Shirizli';

const rdiInstance: AddNewRdiParameters = {
    name: 'testInstance',
    url: 'http://localhost:4000',
    username: 'username',
    password: 'password',
};
//skip the tests until rdi integration is added

fixture.skip `Rdi dry run job`
    .meta({ type: 'critical_path' })
    // it will be removed
    .page(commonUrl)
    .beforeEach(async() => {
        await t.maximizeWindow();

    })
    .afterEach(async() => {
        await rdiApiRequests.deleteAllRdiApi();
    });
test('Verify that user can use Dry run panel', async() => {
    const instanceId = 'testId';
    const job = 'testJob';

    // Need to add method to add jobs once it is implemented

    await rdiApiRequests.addNewRdiApi(rdiInstance);
    await updateColumnValueInDBTable(rdiTable, 'id', instanceId);
    await t.navigateTo(commonUrl + `/${instanceId}/pipeline/config`);
    await rdiInstancePage.openJobByName(job);
    await t.click(rdiInstancePage.dryRunButton);
    // Verify that user can see dry run a job right panel
    await t.expect(rdiInstancePage.dryRunPanel.visible).ok('Dry run panel not opened');

    // Verify that user dry run only JSON value in Input
    await rdiInstancePage.sendTransformationInput('testInvalid');
    await t.expect(rdiInstancePage.dryRunSubmitBtn.getAttribute('class')).contains('isDisabled', 'Dry run button enabled when input is not JSON');

    // Verify that user can see the request to display the “output” section results sent only when click the “Dry run” button (not when switching between the tabs)
    await t.click(rdiInstancePage.outputTab);
    await t.expect(rdiInstancePage.commandsOutput.textContent).contains('', 'Transformation output is not empty by default');

    // Verify that user can request to run the transformation logic
    await t.click(rdiInstancePage.transformationsTab);
    await rdiInstancePage.sendTransformationInput('1');
    await t.expect(rdiInstancePage.transformationResults.textContent).contains(resultMock, 'Transformation results not displayed');

    await t.click(rdiInstancePage.outputTab);
    await t.expect(rdiInstancePage.commandsOutput.innerText).contains(outputMock, 'Transformation output not displayed');
    // Verify that user can close the right panel
    await t.click(rdiInstancePage.closeDryRunPanelBtn);
    await t.expect(rdiInstancePage.dryRunPanel.exists).notOk('Dry run panel still displayed');
});